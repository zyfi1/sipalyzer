use crate::core::config::RegistrarConfig;
use crate::sip::register::{RegistrationResult, RegistrationTester};
use crate::sip::uri::SipUri;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::net::ToSocketAddrs;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TestType {
    BasicRegistration,
    Reregistration,
    Deregistration,
    NetworkConnectivity,
    TransportValidation,
    ExpiresHeader,
    ContactHeader,
    ErrorHandling,
    NatTraversal,
    FirewallTest,
    DnsSrvTest,
    RegistrationStability,
    NetworkConditions,
    MultiTransport,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestResult {
    pub test_type: TestType,
    pub success: bool,
    pub result: RegistrationResult,
    pub diagnostics: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestSuiteResult {
    pub registrar_id: String,
    pub tests: Vec<TestResult>,
    pub overall_success: bool,
    pub total_tests: usize,
    pub passed_tests: usize,
    pub failed_tests: usize,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct TestConfig {
    pub timeout_seconds: Option<u64>,
    pub expires_values: Option<Vec<u32>>,
    pub concurrent_requests: Option<usize>,
    pub delay_between_registrations_ms: Option<u64>,
    pub test_tcp: Option<bool>,
    pub test_udp: Option<bool>,
    pub test_dns: Option<bool>,
    pub test_port_range: Option<bool>,
    pub test_packet_sizes: Option<bool>,
    pub test_rate_limiting: Option<bool>,
    pub test_stateful_firewall: Option<bool>,
    pub test_sip_aware: Option<bool>,
    pub invalid_credentials: Option<bool>,
    // DNS/Network options
    pub dns_resolver: Option<String>,
    pub network_interface: Option<String>,
    pub local_port_override: Option<u16>,
    pub remote_port_override: Option<u16>,
    // Transport options
    pub force_transport: Option<String>,
    pub tcp_keepalive: Option<bool>,
    pub tcp_nodelay: Option<bool>,
    pub udp_buffer_size: Option<usize>,
    // Retry options
    pub retry_count: Option<u32>,
    pub retry_delay_ms: Option<u64>,
    // Registration options
    pub custom_expires: Option<u32>,
    pub custom_contact_header: Option<String>,
    pub custom_user_agent: Option<String>,
    pub custom_call_id: Option<String>,
    pub custom_from_tag: Option<String>,
    pub custom_cseq: Option<u32>,
    pub custom_max_forwards: Option<u8>,
    pub custom_request_uri: Option<String>,
    // SIP Protocol options
    pub sip_version: Option<String>,
    pub add_via_params: Option<String>,
    pub add_contact_params: Option<String>,
    pub add_to_params: Option<String>,
    pub add_from_params: Option<String>,
    // Authentication options
    pub force_authentication: Option<bool>,
    pub auth_algorithm: Option<String>,
    pub custom_realm: Option<String>,
    // Test-specific
    pub test_srv_records: Option<bool>,
    pub test_naptr_records: Option<bool>,
    pub simulate_packet_loss: Option<u32>,
    pub simulate_latency_ms: Option<u64>,
    pub simulate_jitter_ms: Option<u64>,
    pub simulate_bandwidth_kbps: Option<u64>,
    // TLS/Security options
    pub tls_verify_certificate: Option<bool>,
    pub tls_verify_hostname: Option<bool>,
    pub tls_min_version: Option<String>,
    pub tls_cipher_suites: Option<String>,
    pub tls_sni: Option<String>,
    // Network simulation
    pub mtu_size: Option<u16>,
    pub fragment_packets: Option<bool>,
    pub duplicate_packets: Option<bool>,
    pub duplicate_packet_rate: Option<u32>,
    // Test execution
    pub test_iterations: Option<usize>,
    pub success_threshold: Option<u32>,
    pub failure_threshold: Option<u32>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Maximum seconds a single REGISTER exchange (including digest auth) may block inside the
/// UI-driven registrar test suite. Prevents multi-minute hangs when registrars use very
/// large `timeout_seconds` or when tests chain many attempts.
const REGISTRATION_TEST_SUITE_TIMEOUT_CAP_SECS: u64 = 45;

/// Per-socket TCP connect timeout for connectivity / firewall port probes.
const REGISTRATION_TEST_TCP_CONNECT_CAP_SECS: u64 = 8;

fn suite_registration_timeout_secs(
    config: &RegistrarConfig,
    test_config: Option<&TestConfig>,
) -> u64 {
    let requested = test_config
        .and_then(|c| c.timeout_seconds)
        .unwrap_or(config.timeout_seconds)
        .max(1);
    requested.min(REGISTRATION_TEST_SUITE_TIMEOUT_CAP_SECS)
}

fn config_for_registration_test(
    config: &RegistrarConfig,
    test_config: Option<&TestConfig>,
) -> RegistrarConfig {
    let mut c = config.clone();
    c.timeout_seconds = suite_registration_timeout_secs(config, test_config);
    c
}

fn tcp_probe_timeout_secs(timeout_secs: u64) -> u64 {
    timeout_secs
        .max(1)
        .min(REGISTRATION_TEST_TCP_CONNECT_CAP_SECS)
}

pub struct TestSuite;

impl TestSuite {
    /// Run a test suite for a registrar
    pub fn run_suite(
        config: &RegistrarConfig,
        test_types: &[TestType],
        test_configs: &HashMap<TestType, TestConfig>,
    ) -> Result<TestSuiteResult> {
        let mut results = Vec::new();
        let mut passed = 0;
        let mut failed = 0;

        for test_type in test_types {
            let test_config = test_configs.get(test_type);
            match Self::run_test(config, test_type, test_config) {
                Ok(test_result) => {
                    if test_result.success {
                        passed += 1;
                    } else {
                        failed += 1;
                    }
                    results.push(test_result);
                }
                Err(e) => {
                    failed += 1;
                    results.push(TestResult {
                        test_type: test_type.clone(),
                        success: false,
                        result: RegistrationResult {
                            success: false,
                            status_code: 0,
                            status_text: "Error".to_string(),
                            response_time_ms: 0,
                            expires: None,
                            error: Some(format!("Test execution failed: {}", e)),
                            request_message: String::new(),
                            response_message: String::new(),
                        },
                        diagnostics: Some(serde_json::json!({
                            "error": e.to_string()
                        })),
                    });
                }
            }
        }

        Ok(TestSuiteResult {
            registrar_id: config.id.clone(),
            tests: results,
            overall_success: failed == 0,
            total_tests: test_types.len(),
            passed_tests: passed,
            failed_tests: failed,
        })
    }

    /// Run a single test
    fn run_test(
        config: &RegistrarConfig,
        test_type: &TestType,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        match test_type {
            TestType::BasicRegistration => Self::test_basic_registration(config, test_config),
            TestType::Reregistration => Self::test_reregistration(config, test_config),
            TestType::Deregistration => Self::test_deregistration(config, test_config),
            TestType::NetworkConnectivity => Self::test_network_connectivity(config, test_config),
            TestType::TransportValidation => Self::test_transport_validation(config, test_config),
            TestType::ExpiresHeader => Self::test_expires_header(config, test_config),
            TestType::ContactHeader => Self::test_contact_header(config, test_config),
            TestType::ErrorHandling => Self::test_error_handling(config, test_config),
            TestType::NatTraversal => Self::test_nat_traversal(config, test_config),
            TestType::FirewallTest => Self::test_firewall(config, test_config),
            TestType::DnsSrvTest => Self::test_dns_srv(config, test_config),
            TestType::RegistrationStability => {
                Self::test_registration_stability(config, test_config)
            }
            TestType::NetworkConditions => Self::test_network_conditions(config, test_config),
            TestType::MultiTransport => Self::test_multi_transport(config, test_config),
        }
    }

    /// Basic registration test (existing functionality)
    fn test_basic_registration(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let config_with_timeout = config_for_registration_test(config, test_config);
        let result = RegistrationTester::test_registration(&config_with_timeout)?;

        // Check if authentication was required (401/407 indicates auth challenge)
        let auth_required = result.status_code == 401 || result.status_code == 407;
        let auth_successful =
            result.success && (result.status_code >= 200 && result.status_code < 300);

        Ok(TestResult {
            test_type: TestType::BasicRegistration,
            success: result.success,
            result: result.clone(),
            diagnostics: Some(serde_json::json!({
                "status_code": result.status_code,
                "status_text": result.status_text,
                "response_time_ms": result.response_time_ms,
                "expires": result.expires,
                "auth_required": auth_required,
                "auth_successful": auth_successful,
                "transport": format!("{:?}", config.transport),
                "registrar": format!("{}:{}", config.domain, config.remote_port)
            })),
        })
    }

    /// Re-registration test - tests periodic refresh
    fn test_reregistration(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let delay_ms = test_config
            .and_then(|c| c.delay_between_registrations_ms)
            .unwrap_or(500);
        let config_with_timeout = config_for_registration_test(config, test_config);

        // First register
        let first_result = RegistrationTester::test_registration(&config_with_timeout)?;

        if !first_result.success {
            return Ok(TestResult {
                test_type: TestType::Reregistration,
                success: false,
                result: first_result,
                diagnostics: Some(serde_json::json!({
                    "reason": "Initial registration failed"
                })),
            });
        }

        // Wait configured delay then re-register
        std::thread::sleep(Duration::from_millis(delay_ms));

        // Re-register with same config
        let second_result = RegistrationTester::test_registration(&config_with_timeout)?;

        Ok(TestResult {
            test_type: TestType::Reregistration,
            success: second_result.success,
            result: second_result.clone(),
            diagnostics: Some(serde_json::json!({
                "first_registration": first_result.status_code,
                "second_registration": second_result.status_code,
                "delay_ms": delay_ms
            })),
        })
    }

    /// De-registration test - sends REGISTER with Expires: 0
    fn test_deregistration(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let config_with_timeout = config_for_registration_test(config, test_config);

        // First register normally
        let register_result = RegistrationTester::test_registration(&config_with_timeout)?;

        if !register_result.success {
            return Ok(TestResult {
                test_type: TestType::Deregistration,
                success: false,
                result: register_result,
                diagnostics: Some(serde_json::json!({
                    "reason": "Initial registration failed, cannot test deregistration"
                })),
            });
        }

        // Now deregister with Expires: 0
        let result = RegistrationTester::test_registration_with_expires(&config_with_timeout, 0)?;

        Ok(TestResult {
            test_type: TestType::Deregistration,
            success: result.success && result.status_code >= 200 && result.status_code < 300,
            result,
            diagnostics: Some(serde_json::json!({
                "expires": 0,
                "initial_registration": register_result.status_code
            })),
        })
    }

    /// Network connectivity test
    fn test_network_connectivity(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let timeout_secs =
            tcp_probe_timeout_secs(test_config.and_then(|c| c.timeout_seconds).unwrap_or(5));
        let test_tcp = test_config.and_then(|c| c.test_tcp).unwrap_or(true);
        let test_dns = test_config.and_then(|c| c.test_dns).unwrap_or(true);

        let registrar_uri =
            SipUri::parse(&config.domain).context("Failed to parse registrar domain")?;

        let registrar_port = registrar_uri.port.unwrap_or(config.remote_port);
        let registrar_host = registrar_uri.host_for_resolution();

        let mut diagnostics = serde_json::json!({
            "host": registrar_host,
            "port": registrar_port,
        });

        let mut is_ok = true;
        let mut error_msg = None;

        // Test DNS resolution if enabled
        if test_dns {
            match format!("{}:{}", registrar_host, registrar_port).to_socket_addrs() {
                Ok(mut addrs) => {
                    if let Some(addr) = addrs.next() {
                        diagnostics["resolved_address"] = serde_json::json!(addr.to_string());
                        diagnostics["dns_resolution"] = serde_json::json!(true);

                        // Test TCP connectivity if enabled
                        if test_tcp {
                            let timeout = Duration::from_secs(timeout_secs);
                            match std::net::TcpStream::connect_timeout(&addr, timeout) {
                                Ok(_) => {
                                    diagnostics["tcp_connectivity"] = serde_json::json!(true);
                                }
                                Err(e) => {
                                    is_ok = false;
                                    error_msg = Some(e.to_string());
                                    diagnostics["tcp_connectivity"] = serde_json::json!(false);
                                }
                            }
                        }
                    } else {
                        is_ok = false;
                        error_msg = Some("No addresses found".to_string());
                        diagnostics["dns_resolution"] = serde_json::json!(false);
                    }
                }
                Err(e) => {
                    is_ok = false;
                    error_msg = Some(format!("DNS resolution failed: {}", e));
                    diagnostics["dns_resolution"] = serde_json::json!(false);
                }
            }
        }

        Ok(TestResult {
            test_type: TestType::NetworkConnectivity,
            success: is_ok,
            result: RegistrationResult {
                success: is_ok,
                status_code: if is_ok { 200 } else { 0 },
                status_text: if is_ok {
                    "Connected".to_string()
                } else {
                    error_msg
                        .clone()
                        .unwrap_or_else(|| "Connection failed".to_string())
                },
                response_time_ms: 0,
                expires: None,
                error: error_msg,
                request_message: String::new(),
                response_message: String::new(),
            },
            diagnostics: Some(diagnostics),
        })
    }

    /// Transport validation test
    fn test_transport_validation(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let config_with_timeout = config_for_registration_test(config, test_config);
        // Test if the configured transport works
        let result = RegistrationTester::test_registration(&config_with_timeout)?;

        Ok(TestResult {
            test_type: TestType::TransportValidation,
            success: result.success,
            result,
            diagnostics: Some(serde_json::json!({
                "transport": format!("{:?}", config.transport)
            })),
        })
    }

    /// Expires header test
    fn test_expires_header(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let expires_values = test_config
            .and_then(|c| c.expires_values.clone())
            .unwrap_or_else(|| vec![60, 300, 3600]);
        // Avoid pathological suites (dozens of REGISTERs × cap still adds up)
        let expires_values: Vec<u32> = expires_values.into_iter().take(5).collect();
        let config_with_timeout = config_for_registration_test(config, test_config);

        // Test with different expires values
        let mut results = Vec::new();
        let mut last_result: Option<RegistrationResult> = None;

        for expires in &expires_values {
            let result =
                RegistrationTester::test_registration_with_expires(&config_with_timeout, *expires)?;
            results.push(serde_json::json!({
                "requested_expires": expires,
                "response_status": result.status_code,
                "actual_expires": result.expires
            }));
            last_result = Some(result);
        }

        let last_result = last_result.context("expires_values was empty")?;

        Ok(TestResult {
            test_type: TestType::ExpiresHeader,
            success: last_result.success,
            result: last_result,
            diagnostics: Some(serde_json::json!({
                "expires_tests": results,
                "tested_values": expires_values
            })),
        })
    }

    /// Contact header test
    fn test_contact_header(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let config_with_timeout = config_for_registration_test(config, test_config);

        // Test registration with different contact formats
        let result = RegistrationTester::test_registration(&config_with_timeout)?;

        // Extract local IP and port for contact header validation
        let registrar_uri =
            SipUri::parse(&config.domain).context("Failed to parse registrar domain")?;
        let registrar_port = registrar_uri.port.unwrap_or(config.remote_port);
        let registrar_host = registrar_uri.host_for_resolution();
        let local_port = config.local_port.unwrap_or(5060);

        let transport = crate::sip::transport::Transport::new(
            config.transport.clone(),
            local_port,
            registrar_host,
            registrar_port,
        )?;
        let local_ip = transport.get_local_ip_address();

        // Check if Contact header contains local IP (basic validation)
        let contact_in_response = result.response_message.contains(&local_ip);
        let contact_format_valid = result.response_message.contains("Contact:")
            || result.response_message.contains("contact:");

        Ok(TestResult {
            test_type: TestType::ContactHeader,
            success: result.success,
            result: result.clone(),
            diagnostics: Some(serde_json::json!({
                "contact_header_validated": result.success && contact_in_response,
                "contact_header_present": contact_format_valid,
                "local_ip_in_contact": contact_in_response,
                "local_ip": local_ip,
                "local_port": local_port,
                "contact_format": if contact_format_valid { "RFC 3261 compliant" } else { "Not found" },
                "status_code": result.status_code
            })),
        })
    }

    /// Error handling test
    ///
    /// This is meant to answer:
    ///  1. Does a *valid* registration behave as expected?
    ///  2. Does the registrar correctly reject obviously bad credentials?
    ///  3. Do we surface clear information about the failure mode?
    fn test_error_handling(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let use_invalid = test_config
            .and_then(|c| c.invalid_credentials)
            .unwrap_or(true);

        let cfg = config_for_registration_test(config, test_config);

        // 1) Baseline: run a normal registration with the configured credentials
        let valid_result = RegistrationTester::test_registration(&cfg)?;
        let valid_ok = valid_result.success
            && valid_result.status_code >= 200
            && valid_result.status_code < 300;

        // 2) Intentionally broken credentials – we expect this to *fail* in a well‑defined way
        let mut invalid_result_opt: Option<RegistrationResult> = None;
        if use_invalid {
            let mut invalid_cfg = cfg.clone();
            // Intentionally nonsense password; we don't persist this anywhere
            invalid_cfg.password = "this_is_intentionally_invalid".to_string();
            let invalid = RegistrationTester::test_registration(&invalid_cfg)?;
            invalid_result_opt = Some(invalid);
        }

        // Evaluate the \"error handling\" behaviour
        let (invalid_ok, invalid_status_code) = if let Some(ref invalid) = invalid_result_opt {
            let code = invalid.status_code;
            // Consider proper handling if we either:
            //  - get a 4xx/5xx SIP error back, or
            //  - get a clear error flag from the client
            let looks_like_auth_rejection =
                (code >= 400 && code < 600) || (!invalid.success && invalid.error.is_some());
            (looks_like_auth_rejection, Some(code))
        } else {
            (true, None) // if we didn't run the invalid path, don't fail the test on that
        };

        // Overall success:
        //  - valid registration should work
        //  - invalid credentials should *not* look like a successful registration
        let overall_success = valid_ok && invalid_ok;

        // We still have to return a single RegistrationResult in TestResult; use the valid one
        // as canonical, but embed both attempts in diagnostics.
        Ok(TestResult {
            test_type: TestType::ErrorHandling,
            success: overall_success,
            result: valid_result.clone(),
            diagnostics: Some(serde_json::json!({
                "valid_attempt": {
                    "success": valid_result.success,
                    "status_code": valid_result.status_code,
                    "status_text": valid_result.status_text,
                    "response_time_ms": valid_result.response_time_ms,
                },
                "invalid_credentials_attempt": invalid_result_opt.as_ref().map(|inv| {
                    serde_json::json!({
                        "success": inv.success,
                        "status_code": inv.status_code,
                        "status_text": inv.status_text,
                        "response_time_ms": inv.response_time_ms,
                        "error": inv.error,
                    })
                }),
                "used_invalid_credentials": use_invalid,
                "valid_registration_ok": valid_ok,
                "invalid_credentials_rejected": invalid_ok,
                "invalid_credentials_status_code": invalid_status_code,
            })),
        })
    }

    /// NAT Traversal test - detects if behind NAT/firewall
    fn test_nat_traversal(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let config_with_timeout = config_for_registration_test(config, test_config);

        // Perform registration to get Contact header info
        let result = RegistrationTester::test_registration(&config_with_timeout)?;

        // Extract local IP from transport
        let registrar_uri =
            SipUri::parse(&config.domain).context("Failed to parse registrar domain")?;
        let registrar_port = registrar_uri.port.unwrap_or(config.remote_port);
        let registrar_host = registrar_uri.host_for_resolution();
        let local_port = config.local_port.unwrap_or(5060);

        let transport = crate::sip::transport::Transport::new(
            config.transport.clone(),
            local_port,
            registrar_host,
            registrar_port,
        )?;

        let local_ip = transport.get_local_ip_address();

        // Check if IP is private (RFC 1918) - indicates NAT
        let is_private = local_ip.starts_with("10.")
            || local_ip.starts_with("192.168.")
            || local_ip.starts_with("172.16.")
            || local_ip.starts_with("172.17.")
            || local_ip.starts_with("172.18.")
            || local_ip.starts_with("172.19.")
            || local_ip.starts_with("172.20.")
            || local_ip.starts_with("172.21.")
            || local_ip.starts_with("172.22.")
            || local_ip.starts_with("172.23.")
            || local_ip.starts_with("172.24.")
            || local_ip.starts_with("172.25.")
            || local_ip.starts_with("172.26.")
            || local_ip.starts_with("172.27.")
            || local_ip.starts_with("172.28.")
            || local_ip.starts_with("172.29.")
            || local_ip.starts_with("172.30.")
            || local_ip.starts_with("172.31.");

        // Parse response to check Contact header
        let contact_in_response = result.response_message.contains(&local_ip);

        Ok(TestResult {
            test_type: TestType::NatTraversal,
            success: result.success,
            result,
            diagnostics: Some(serde_json::json!({
                "local_ip": local_ip,
                "is_private_ip": is_private,
                "behind_nat": is_private,
                "contact_header_in_response": contact_in_response,
                "nat_detection": if is_private { "Likely behind NAT" } else { "Public IP detected" }
            })),
        })
    }

    /// Firewall test - comprehensive firewall rules and port accessibility testing
    fn test_firewall(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let timeout_secs =
            tcp_probe_timeout_secs(test_config.and_then(|c| c.timeout_seconds).unwrap_or(10));
        let base_reg = config_for_registration_test(config, test_config);
        let test_tcp = test_config.and_then(|c| c.test_tcp).unwrap_or(true);
        let test_udp = test_config.and_then(|c| c.test_udp).unwrap_or(true);
        let test_port_range = test_config.and_then(|c| c.test_port_range).unwrap_or(false);
        let test_packet_sizes = test_config
            .and_then(|c| c.test_packet_sizes)
            .unwrap_or(false);
        let test_rate_limiting = test_config
            .and_then(|c| c.test_rate_limiting)
            .unwrap_or(false);
        let test_stateful_firewall = test_config
            .and_then(|c| c.test_stateful_firewall)
            .unwrap_or(false);
        let test_sip_aware = test_config.and_then(|c| c.test_sip_aware).unwrap_or(false);

        let registrar_uri =
            SipUri::parse(&config.domain).context("Failed to parse registrar domain")?;

        let registrar_port = registrar_uri.port.unwrap_or(config.remote_port);
        let registrar_host = registrar_uri.host_for_resolution();

        let mut diagnostics = serde_json::json!({
            "host": registrar_host,
            "configured_port": registrar_port,
            "transport": format!("{:?}", config.transport),
            "tcp_ports": {},
            "udp_ports": {},
            "port_range_test": {},
            "packet_size_test": {},
            "rate_limiting_test": {},
            "stateful_firewall_test": {},
            "sip_aware_test": {},
        });

        let mut all_accessible = true;
        let mut accessible_ports = Vec::new();
        let mut blocked_ports = Vec::new();

        // Helper function to test a TCP port
        let test_tcp_port = |host: &str,
                             port: u16,
                             accessible_ports: &mut Vec<String>,
                             blocked_ports: &mut Vec<String>|
         -> bool {
            match format!("{}:{}", host, port).to_socket_addrs() {
                Ok(mut addrs) => {
                    if let Some(addr) = addrs.next() {
                        match std::net::TcpStream::connect_timeout(
                            &addr,
                            Duration::from_secs(timeout_secs),
                        ) {
                            Ok(_) => {
                                accessible_ports.push(format!("TCP:{}", port));
                                true
                            }
                            Err(_) => {
                                blocked_ports.push(format!("TCP:{}", port));
                                false
                            }
                        }
                    } else {
                        blocked_ports.push(format!("TCP:{}", port));
                        false
                    }
                }
                Err(_) => {
                    blocked_ports.push(format!("TCP:{}", port));
                    false
                }
            }
        };

        // Helper function to test a UDP port (via registration attempt)
        let test_udp_port = |port: u16,
                             accessible_ports: &mut Vec<String>,
                             blocked_ports: &mut Vec<String>|
         -> bool {
            let mut port_reg = base_reg.clone();
            port_reg.remote_port = port;
            match RegistrationTester::test_registration(&port_reg) {
                Ok(result) => {
                    if result.success {
                        accessible_ports.push(format!("UDP:{}", port));
                        true
                    } else {
                        blocked_ports.push(format!("UDP:{}", port));
                        false
                    }
                }
                Err(_) => {
                    blocked_ports.push(format!("UDP:{}", port));
                    false
                }
            }
        };

        // Test configured registrar port first (most important)
        let configured_tcp_accessible = test_tcp_port(
            &registrar_host,
            registrar_port,
            &mut accessible_ports,
            &mut blocked_ports,
        );
        let configured_udp_accessible =
            test_udp_port(registrar_port, &mut accessible_ports, &mut blocked_ports);

        diagnostics["tcp_ports"][registrar_port.to_string()] = serde_json::json!({
            "accessible": configured_tcp_accessible,
            "configured": true,
            "description": "Registrar configured port"
        });
        diagnostics["udp_ports"][registrar_port.to_string()] = serde_json::json!({
            "accessible": configured_udp_accessible,
            "configured": true,
            "description": "Registrar configured port"
        });

        if !configured_tcp_accessible && !configured_udp_accessible {
            all_accessible = false;
        }

        // Test standard SIP ports (if different from configured port)
        if test_tcp {
            let mut ports = vec![5060, 5061, 80, 443]; // SIP, SIPS, HTTP, HTTPS
                                                       // Remove configured port if it's already in the list
            ports.retain(|&p| p != registrar_port);

            for port in ports {
                let accessible = test_tcp_port(
                    &registrar_host,
                    port,
                    &mut accessible_ports,
                    &mut blocked_ports,
                );
                diagnostics["tcp_ports"][port.to_string()] = serde_json::json!({
                    "accessible": accessible,
                    "configured": false,
                    "description": match port {
                        5060 => "Standard SIP port",
                        5061 => "Standard SIPS/TLS port",
                        80 => "HTTP port (for SIP over HTTP)",
                        443 => "HTTPS port (for SIP over HTTPS)",
                        _ => "Standard port"
                    }
                });
                if port == 5060 && !accessible {
                    all_accessible = false;
                }
            }
        }

        if test_udp {
            let mut ports = vec![5060, 3478]; // SIP, STUN
                                              // Remove configured port if it's already in the list
            ports.retain(|&p| p != registrar_port);

            for port in ports {
                let accessible = test_udp_port(port, &mut accessible_ports, &mut blocked_ports);
                diagnostics["udp_ports"][port.to_string()] = serde_json::json!({
                    "accessible": accessible,
                    "configured": false,
                    "description": match port {
                        5060 => "Standard SIP port",
                        3478 => "STUN port (for NAT traversal)",
                        _ => "Standard port"
                    }
                });
                if port == 5060 && !accessible {
                    all_accessible = false;
                }
            }
        }

        // Test port range (common SIP port range)
        if test_port_range {
            let mut range_results = serde_json::json!({});
            let ports_to_test = vec![5058, 5059, 5060, 5061, 5062, 5063];
            let total_ports = ports_to_test.len();
            let mut accessible_count = 0;
            for port in &ports_to_test {
                let accessible = test_tcp_port(
                    &registrar_host,
                    *port,
                    &mut accessible_ports,
                    &mut blocked_ports,
                );
                range_results[port.to_string()] = serde_json::json!(accessible);
                if accessible {
                    accessible_count += 1;
                }
            }
            diagnostics["port_range_test"] = serde_json::json!({
                "results": range_results,
                "accessible_count": accessible_count,
                "total_tested": total_ports,
                "pattern": if accessible_count == 0 {
                    "All ports blocked - strict firewall"
                } else if accessible_count == total_ports {
                    "All ports open - permissive firewall"
                } else {
                    "Selective blocking - firewall has specific rules"
                }
            });
        }

        // Test packet sizes (MTU/fragmentation)
        if test_packet_sizes {
            let mut size_results = serde_json::json!({});
            // Each iteration is a full REGISTER — keep small to avoid UI freezes
            let sizes = vec![512, 1500];
            for size in sizes {
                // Test by attempting registration with different message sizes
                // This is a simplified test - in reality we'd send custom-sized packets
                let test_result = RegistrationTester::test_registration(&base_reg)?;
                size_results[size.to_string()] = serde_json::json!({
                    "accessible": test_result.success,
                    "response_time_ms": test_result.response_time_ms
                });
            }
            diagnostics["packet_size_test"] = serde_json::json!({
                "results": size_results,
                "note": "Tests indicate if firewall handles different packet sizes correctly"
            });
        }

        // Test rate limiting
        if test_rate_limiting {
            let mut rate_results = Vec::new();
            let mut success_count = 0;
            let mut failure_count = 0;

            // Few rapid requests — each may wait up to suite timeout cap
            for i in 0..5 {
                match RegistrationTester::test_registration(&base_reg) {
                    Ok(result) => {
                        if result.success {
                            success_count += 1;
                        } else {
                            failure_count += 1;
                        }
                        rate_results.push(serde_json::json!({
                            "attempt": i + 1,
                            "success": result.success,
                            "response_time_ms": result.response_time_ms
                        }));
                        // Small delay to avoid overwhelming
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => {
                        failure_count += 1;
                    }
                }
            }

            diagnostics["rate_limiting_test"] = serde_json::json!({
                "results": rate_results,
                "success_count": success_count,
                "failure_count": failure_count,
                "rate_limiting_detected": failure_count > success_count && failure_count > 5,
                "assessment": if failure_count > success_count && failure_count > 5 {
                    "Rate limiting likely active - firewall may be throttling requests"
                } else {
                    "No significant rate limiting detected"
                }
            });
        }

        // Test stateful firewall (connection tracking)
        if test_stateful_firewall {
            // Test if firewall allows return traffic for established connections
            // This is done by making a connection and checking if we can receive data
            match format!("{}:{}", registrar_host, registrar_port).to_socket_addrs() {
                Ok(mut addrs) => {
                    if let Some(addr) = addrs.next() {
                        match std::net::TcpStream::connect_timeout(
                            &addr,
                            Duration::from_secs(timeout_secs),
                        ) {
                            Ok(mut stream) => {
                                // Try to read from the connection
                                stream.set_read_timeout(Some(Duration::from_secs(2)))?;
                                let mut buf = vec![0u8; 1];
                                let can_receive = stream.read(&mut buf).is_ok();

                                diagnostics["stateful_firewall_test"] = serde_json::json!({
                                    "connection_established": true,
                                    "can_receive_data": can_receive,
                                    "stateful": can_receive,
                                    "assessment": if can_receive {
                                        "Stateful firewall detected - allows return traffic"
                                    } else {
                                        "Stateless firewall or connection blocked"
                                    }
                                });
                            }
                            Err(_) => {
                                diagnostics["stateful_firewall_test"] = serde_json::json!({
                                    "connection_established": false,
                                    "assessment": "Cannot establish connection to test stateful behavior"
                                });
                            }
                        }
                    }
                }
                Err(_) => {}
            }
        }

        // Test SIP-aware firewall (deep packet inspection)
        if test_sip_aware {
            // Test with valid SIP message
            let valid_result = RegistrationTester::test_registration(&base_reg)?;

            // Test with malformed SIP message (if firewall is SIP-aware, it might block this)
            // For now, we'll use the registration result as a proxy
            diagnostics["sip_aware_test"] = serde_json::json!({
                "valid_sip_accepted": valid_result.success,
                "status_code": valid_result.status_code,
                "assessment": if valid_result.status_code == 400 || valid_result.status_code == 500 {
                    "Firewall may be performing SIP inspection - returned SIP error code"
                } else if !valid_result.success {
                    "Connection blocked - firewall may be SIP-aware"
                } else {
                    "SIP traffic allowed - firewall may not inspect SIP content"
                },
                "note": "SIP-aware firewalls may inspect SIP headers and block invalid messages"
            });
        }

        // Summary
        diagnostics["summary"] = serde_json::json!({
            "accessible_ports": accessible_ports,
            "blocked_ports": blocked_ports,
            "overall_status": if all_accessible {
                "Ports accessible - firewall likely allows SIP traffic"
            } else {
                "Some ports blocked - firewall may be restricting SIP traffic"
            },
            "recommendations": if !all_accessible {
                vec![
                    "Check firewall rules for SIP ports (5060, 5061)",
                    "Verify UDP port 5060 is not blocked",
                    "Consider using TCP if UDP is blocked",
                    "Check for SIP ALG (Application Layer Gateway) on firewall"
                ]
            } else {
                vec!["Firewall configuration appears to allow SIP traffic"]
            }
        });

        // Create a result for the test
        let result = RegistrationTester::test_registration(&base_reg)?;

        Ok(TestResult {
            test_type: TestType::FirewallTest,
            success: all_accessible && result.success,
            result,
            diagnostics: Some(diagnostics),
        })
    }

    /// DNS SRV/NAPTR test - tests DNS-based failover discovery
    fn test_dns_srv(
        config: &RegistrarConfig,
        _test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let registrar_uri =
            SipUri::parse(&config.domain).context("Failed to parse registrar domain")?;
        let registrar_host = registrar_uri.host_for_resolution();

        // For now, test basic DNS resolution
        // Full SRV/NAPTR support would require trust-dns-resolver
        let mut diagnostics = serde_json::json!({
            "host": registrar_host,
            "srv_records_available": false,
            "naptr_records_available": false,
        });

        let mut is_ok = true;

        // Test basic DNS resolution
        match format!("{}:{}", registrar_host, config.remote_port).to_socket_addrs() {
            Ok(mut addrs) => {
                if let Some(addr) = addrs.next() {
                    diagnostics["resolved_address"] = serde_json::json!(addr.to_string());
                    diagnostics["dns_resolution"] = serde_json::json!(true);
                    diagnostics["note"] = serde_json::json!("SRV/NAPTR record lookup requires DNS library - basic resolution successful");
                } else {
                    is_ok = false;
                    diagnostics["dns_resolution"] = serde_json::json!(false);
                }
            }
            Err(_e) => {
                is_ok = false;
                diagnostics["dns_resolution"] = serde_json::json!(false);
            }
        }

        Ok(TestResult {
            test_type: TestType::DnsSrvTest,
            success: is_ok,
            result: RegistrationResult {
                success: is_ok,
                status_code: if is_ok { 200 } else { 0 },
                status_text: if is_ok {
                    "DNS resolution successful".to_string()
                } else {
                    "DNS resolution failed".to_string()
                },
                response_time_ms: 0,
                expires: None,
                error: if is_ok {
                    None
                } else {
                    Some("DNS resolution failed".to_string())
                },
                request_message: String::new(),
                response_message: String::new(),
            },
            diagnostics: Some(diagnostics),
        })
    }

    /// Registration stability test - tests long-term registration maintenance
    fn test_registration_stability(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let delay_ms = test_config
            .and_then(|c| c.delay_between_registrations_ms)
            .unwrap_or(2000)
            .min(5000);
        let config_with_timeout = config_for_registration_test(config, test_config);

        // Three REGISTER attempts (not four) — each bounded by suite timeout cap
        let mut results = Vec::new();
        let mut all_successful = true;
        let mut last_result = RegistrationTester::test_registration(&config_with_timeout)?;
        results.push(serde_json::json!({
            "attempt": 1,
            "status_code": last_result.status_code,
            "success": last_result.success,
            "response_time_ms": last_result.response_time_ms
        }));
        if !last_result.success {
            all_successful = false;
        }
        for i in 1..3 {
            std::thread::sleep(Duration::from_millis(delay_ms));
            last_result = RegistrationTester::test_registration(&config_with_timeout)?;
            results.push(serde_json::json!({
                "attempt": i + 1,
                "status_code": last_result.status_code,
                "success": last_result.success,
                "response_time_ms": last_result.response_time_ms
            }));
            if !last_result.success {
                all_successful = false;
            }
        }

        Ok(TestResult {
            test_type: TestType::RegistrationStability,
            success: all_successful && last_result.success,
            result: last_result,
            diagnostics: Some(serde_json::json!({
                "stability_tests": results,
                "all_successful": all_successful,
                "test_count": 3
            })),
        })
    }

    /// Network conditions test - tests registration under poor network conditions
    fn test_network_conditions(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let config_with_timeout = config_for_registration_test(config, test_config);

        // Perform registration and measure response time
        let result = RegistrationTester::test_registration(&config_with_timeout)?;

        // Analyze response time to determine network quality
        let response_time = result.response_time_ms;
        let network_quality: &str = if response_time < 100 {
            "Excellent"
        } else if response_time < 300 {
            "Good"
        } else if response_time < 1000 {
            "Fair"
        } else {
            "Poor"
        };

        let has_packet_loss = result.error.is_some() && !result.success;
        let latency_assessment: &str = if response_time > 1000 {
            "High latency detected"
        } else {
            "Acceptable latency"
        };

        Ok(TestResult {
            test_type: TestType::NetworkConditions,
            success: result.success,
            result,
            diagnostics: Some(serde_json::json!({
                "response_time_ms": response_time,
                "network_quality": network_quality,
                "potential_packet_loss": has_packet_loss,
                "latency_assessment": latency_assessment
            })),
        })
    }

    /// Multi-transport test - tests registration across different transports
    fn test_multi_transport(
        config: &RegistrarConfig,
        test_config: Option<&TestConfig>,
    ) -> Result<TestResult> {
        let config_with_timeout = config_for_registration_test(config, test_config);

        // Test current transport
        let current_result = RegistrationTester::test_registration(&config_with_timeout)?;

        let mut transport_results = vec![serde_json::json!({
            "transport": format!("{:?}", config.transport),
            "success": current_result.success,
            "status_code": current_result.status_code,
            "response_time_ms": current_result.response_time_ms
        })];

        // Try UDP if current is not UDP
        if !matches!(config.transport, crate::core::config::TransportType::Udp) {
            let mut udp_config = config_with_timeout.clone();
            udp_config.transport = crate::core::config::TransportType::Udp;
            if let Ok(udp_result) = RegistrationTester::test_registration(&udp_config) {
                transport_results.push(serde_json::json!({
                    "transport": "Udp",
                    "success": udp_result.success,
                    "status_code": udp_result.status_code,
                    "response_time_ms": udp_result.response_time_ms
                }));
            }
        }

        Ok(TestResult {
            test_type: TestType::MultiTransport,
            success: current_result.success,
            result: current_result,
            diagnostics: Some(serde_json::json!({
                "transport_tests": transport_results,
                "primary_transport": format!("{:?}", config.transport)
            })),
        })
    }
}
