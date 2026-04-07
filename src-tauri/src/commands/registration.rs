use crate::commands::packet_capture::{
    get_interface_for_ip, list_interfaces, start_capture_session, stop_capture,
};
use crate::core::config;
use crate::core::credentials::CredentialStore;
use crate::core::database::Database;
use crate::packet_capture::FilterConfig;
use crate::sip::register::RegistrationTester;
use crate::sip::tests::{TestSuite, TestType};
use crate::sip::transport;
use crate::sip::transport::Transport;
use crate::sip::uri::SipUri;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::command;
use uuid::Uuid;

fn is_registered_200(result: &crate::sip::register::RegistrationResult) -> bool {
    result.success && result.status_code == 200
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registrar {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub domain: String,
    pub remote_port: u16,
    pub local_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtp_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listening_port: Option<u16>,
    pub transport: String,
    pub username: String,
    pub realm: Option<String>,
    pub timeout_seconds: u64,
    pub retry_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub register_interval_seconds: Option<u64>,
    pub tags: Vec<String>,
    pub group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_case: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voicemail_number: Option<String>,
    #[serde(default)]
    pub mwi_enabled: bool,
    /// Auto-register on startup. Default false — user must explicitly register.
    #[serde(default)]
    pub auto_register: bool,
    /// Persisted display order for manual sorting.
    #[serde(default)]
    pub sort_order: Option<i64>,
    // Password is not included in serialization for security
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrationStatus {
    pub registrar_id: String,
    pub registered: bool,
    pub status_code: Option<u16>,
    pub status_text: Option<String>,
    pub expires_at: Option<String>,
    pub last_test_time: Option<String>,
    pub response_time_ms: Option<u64>,
}

#[command]
#[tracing::instrument(skip_all)]
pub fn create_registrar(registrar: Registrar, password: String) -> Result<String, String> {
    let registrar_id = Uuid::new_v4().to_string();

    // Encrypt password before storing
    let encrypted_password = CredentialStore::encrypt_password(&password)
        .map_err(|e| format!("Failed to encrypt password: {}", e))?;

    let transport = match registrar.transport.as_str() {
        "udp" => config::TransportType::Udp,
        "tcp" => config::TransportType::Tcp,
        "tls" => config::TransportType::Tls,
        "wss" => config::TransportType::Wss,
        _ => return Err("Invalid transport type".to_string()),
    };

    // New registrars go to the end: max(sort_order) + 1
    let existing_registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;
    let max_sort = existing_registrars
        .iter()
        .map(|r| r.sort_order)
        .max()
        .unwrap_or(-1);

    let registrar_config = config::RegistrarConfig {
        id: registrar_id.clone(),
        name: registrar.name,
        domain: registrar.domain,
        remote_port: registrar.remote_port,
        local_port: registrar.local_port,
        listening_port: registrar.listening_port,
        rtp_port: registrar.rtp_port,
        transport,
        username: registrar.username,
        auth_username: None,
        password: encrypted_password, // Stored encrypted
        realm: registrar.realm,
        custom_headers: Vec::new(),
        timeout_seconds: registrar.timeout_seconds,
        retry_count: registrar.retry_count,
        register_interval_seconds: registrar.register_interval_seconds,
        tags: registrar.tags,
        group: registrar.group,
        use_case: registrar.use_case,
        voicemail_number: registrar.voicemail_number,
        mwi_enabled: registrar.mwi_enabled,
        auto_register: registrar.auto_register,
        sort_order: max_sort + 1,
    };

    // Save to encrypted database
    Database::save_registrar(&registrar_config)
        .map_err(|e| format!("Failed to save registrar: {}", e))?;

    let _ = crate::core::audit::AuditWriter::write_entry(
        "registration",
        "create_registrar",
        "user",
        Some(&registrar_id),
        Some(&registrar_config.name),
    );

    Ok(registrar_id)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn update_registrar(
    id: String,
    registrar: Registrar,
    password: Option<String>,
) -> Result<(), String> {
    // Load existing registrar to preserve ID and update fields
    let existing_registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    let existing = existing_registrars
        .iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "Registrar not found".to_string())?;

    // Encrypt password if provided, otherwise keep existing
    let encrypted_password = if let Some(new_password) = password {
        CredentialStore::encrypt_password(&new_password)
            .map_err(|e| format!("Failed to encrypt password: {}", e))?
    } else {
        existing.password.clone()
    };

    let transport = match registrar.transport.as_str() {
        "udp" => config::TransportType::Udp,
        "tcp" => config::TransportType::Tcp,
        "tls" => config::TransportType::Tls,
        "wss" => config::TransportType::Wss,
        _ => return Err("Invalid transport type".to_string()),
    };

    let updated_config = config::RegistrarConfig {
        id: existing.id.clone(),
        name: registrar.name,
        domain: registrar.domain,
        remote_port: registrar.remote_port,
        local_port: registrar.local_port,
        listening_port: registrar.listening_port.or(existing.listening_port),
        rtp_port: registrar.rtp_port.or(existing.rtp_port),
        transport,
        username: registrar.username,
        auth_username: existing.auth_username.clone(),
        password: encrypted_password,
        realm: registrar.realm,
        custom_headers: existing.custom_headers.clone(),
        timeout_seconds: registrar.timeout_seconds,
        retry_count: registrar.retry_count,
        register_interval_seconds: registrar.register_interval_seconds,
        tags: registrar.tags,
        group: registrar.group,
        use_case: registrar.use_case,
        voicemail_number: registrar
            .voicemail_number
            .or(existing.voicemail_number.clone()),
        mwi_enabled: registrar.mwi_enabled,
        auto_register: registrar.auto_register,
        sort_order: existing.sort_order,
    };

    Database::save_registrar(&updated_config)
        .map_err(|e| format!("Failed to update registrar: {}", e))?;

    let _ = crate::core::audit::AuditWriter::write_entry(
        "registration",
        "update_registrar",
        "user",
        Some(&id),
        Some(&updated_config.name),
    );

    Ok(())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_registrar_password(id: String) -> Result<String, String> {
    let registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    let registrar_config = registrars
        .iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "Registrar not found".to_string())?;

    // Decrypt password from database
    let password = CredentialStore::decrypt_password(&registrar_config.password)
        .map_err(|e| format!("Failed to decrypt password: {}", e))?;

    Ok(password)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn delete_registrar(id: String) -> Result<(), String> {
    Database::delete_registrar(&id).map_err(|e| format!("Failed to delete registrar: {}", e))?;
    crate::softphone::clear_registration_binding(&id);
    let _ = crate::core::audit::AuditWriter::write_entry(
        "registration",
        "delete_registrar",
        "user",
        Some(&id),
        None,
    );
    Ok(())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn list_registrars() -> Result<Vec<Registrar>, String> {
    let registrars_config =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    let registrars: Vec<Registrar> = registrars_config
        .iter()
        .map(|r| {
            let transport_str = match r.transport {
                config::TransportType::Udp => "udp",
                config::TransportType::Tcp => "tcp",
                config::TransportType::Tls => "tls",
                config::TransportType::Wss => "wss",
            };

            Registrar {
                id: Some(r.id.clone()),
                name: r.name.clone(),
                domain: r.domain.clone(),
                remote_port: r.remote_port,
                local_port: r.local_port,
                rtp_port: r.rtp_port,
                listening_port: r.listening_port,
                transport: transport_str.to_string(),
                username: r.username.clone(),
                realm: r.realm.clone(),
                timeout_seconds: r.timeout_seconds,
                retry_count: r.retry_count,
                register_interval_seconds: r.register_interval_seconds,
                tags: r.tags.clone(),
                group: r.group.clone(),
                use_case: r.use_case.clone(),
                voicemail_number: r.voicemail_number.clone(),
                mwi_enabled: r.mwi_enabled,
                auto_register: r.auto_register,
                sort_order: Some(r.sort_order),
            }
        })
        .collect();

    Ok(registrars)
}

/// Get the local IP that would be used for this registrar (so we can pick the right capture interface).
fn get_local_ip_for_registrar(config: &config::RegistrarConfig) -> Result<String, String> {
    let local_port = config.local_port.unwrap_or(5060);
    let registrar_uri =
        SipUri::parse(&config.domain).map_err(|e| format!("Invalid domain: {}", e))?;
    let registrar_port = registrar_uri.port.unwrap_or(config.remote_port);
    let registrar_host = registrar_uri.host_for_resolution();
    let transport_type = match config.transport {
        config::TransportType::Udp => config::TransportType::Udp,
        config::TransportType::Tcp => config::TransportType::Tcp,
        config::TransportType::Tls => config::TransportType::Tls,
        config::TransportType::Wss => config::TransportType::Wss,
    };
    let mut transport = Transport::new(transport_type, local_port, registrar_host, registrar_port)
        .map_err(|e| format!("Failed to create transport: {}", e))?;
    transport
        .update_local_ip()
        .map_err(|e| format!("Failed to get local IP: {}", e))?;
    Ok(transport.get_local_ip_address())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn test_registration(id: String) -> Result<serde_json::Value, String> {
    let registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    let registrar_config = registrars
        .iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "Registrar not found".to_string())?;

    // Decrypt password from database
    let password = CredentialStore::decrypt_password(&registrar_config.password)
        .map_err(|e| format!("Failed to decrypt password: {}", e))?;

    let mut config_with_password = registrar_config.clone();
    config_with_password.password = password;

    let result = RegistrationTester::test_registration(&config_with_password)
        .map_err(|e| format!("Registration test failed: {}", e))?;
    if is_registered_200(&result) {
        crate::softphone::set_registration_binding(&config_with_password);
    }

    // Save test result to database so get_registration_health can see it
    // Format matches TestResult structure: { success, result: { ... } }
    let test_result = serde_json::json!({
        "success": result.success,
        "result": {
            "success": result.success,
            "status_code": result.status_code,
            "status_text": result.status_text,
            "response_time_ms": result.response_time_ms,
            "expires": result.expires,
            "error": result.error,
            "request_message": result.request_message,
            "response_message": result.response_message,
        }
    });

    // Save as basic_registration test result
    Database::save_test_result(&id, "basic_registration", &test_result, None).unwrap_or_else(|e| {
        tracing::error!("Failed to save registration test result: {}", e);
    });

    serde_json::to_value(&result).map_err(|e| format!("Failed to serialize result: {}", e))
}

/// Run registration test with a per-test packet capture on the interface used for SIP.
/// Capture runs only for the duration of the test. Result includes capture_session_id for review.
#[command]
#[tracing::instrument(skip_all)]
pub fn test_registration_with_capture(id: String) -> Result<serde_json::Value, String> {
    let registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    let registrar_config = registrars
        .iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "Registrar not found".to_string())?;

    let password = CredentialStore::decrypt_password(&registrar_config.password)
        .map_err(|e| format!("Failed to decrypt password: {}", e))?;

    let mut config_with_password = registrar_config.clone();
    config_with_password.password = password;

    let local_ip = get_local_ip_for_registrar(&config_with_password)?;
    let interface = get_interface_for_ip(local_ip.clone())
        .map_err(|e| format!("Failed to get interface for IP: {}", e))?
        .unwrap_or_else(|| {
            list_interfaces()
                .ok()
                .and_then(|list| {
                    list.into_iter()
                        .find(|i| !i.addresses.is_empty() && !i.name.to_lowercase().contains("lo"))
                })
                .map(|i| i.name)
                .unwrap_or_else(|| "any".to_string())
        });

    let name = format!(
        "Registration test - {} - {}",
        registrar_config.name,
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S")
    );
    // Per-test capture: no filter so we capture all packets on the interface for the test duration.
    let session_id = start_capture_session(
        name,
        Some(format!("Local IP {}", local_ip)),
        interface,
        FilterConfig::default(),
    )?;

    let result = match RegistrationTester::test_registration(&config_with_password) {
        Ok(r) => r,
        Err(e) => {
            let _ = stop_capture(session_id.clone());
            return Err(format!("Registration test failed: {}", e));
        }
    };
    if is_registered_200(&result) {
        crate::softphone::set_registration_binding(&config_with_password);
    }

    let _ = stop_capture(session_id.clone());

    let test_result = serde_json::json!({
        "success": result.success,
        "result": {
            "success": result.success,
            "status_code": result.status_code,
            "status_text": result.status_text,
            "response_time_ms": result.response_time_ms,
            "expires": result.expires,
            "error": result.error,
            "request_message": result.request_message,
            "response_message": result.response_message,
            "capture_session_id": session_id,
        }
    });

    Database::save_test_result(&id, "basic_registration", &test_result, None)
        .unwrap_or_else(|e| tracing::error!("Failed to save registration test result: {}", e));

    let mut out = serde_json::to_value(&result).map_err(|e| e.to_string())?;
    if let Some(obj) = out.as_object_mut() {
        obj.insert(
            "capture_session_id".to_string(),
            serde_json::json!(session_id),
        );
    }
    Ok(out)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_registration_status(id: String) -> Result<RegistrationStatus, String> {
    // For now, return a basic status
    // In a full implementation, this would track ongoing registrations
    Ok(RegistrationStatus {
        registrar_id: id,
        registered: false,
        status_code: None,
        status_text: None,
        expires_at: None,
        last_test_time: None,
        response_time_ms: None,
    })
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_registration_logs(_id: Option<String>) -> Result<Vec<serde_json::Value>, String> {
    // TODO: Implement log retrieval
    Ok(Vec::new())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn export_logs(_id: Option<String>, _format: String) -> Result<String, String> {
    // TODO: Implement log export
    Ok("Export not yet implemented".to_string())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn check_local_port(port: u16) -> Result<bool, String> {
    Ok(transport::check_port_available(port))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_default_local_port() -> Result<u16, String> {
    transport::find_available_port(5060).ok_or_else(|| "No available port found".to_string())
}

#[derive(Debug, Deserialize)]
pub(crate) struct RunTestSuiteArgs {
    id: String,
    #[serde(rename = "testTypes")]
    test_types: Vec<String>,
    #[serde(rename = "testConfigs")]
    test_configs: Option<serde_json::Value>,
}

#[command]
#[tracing::instrument(skip_all)]
pub fn run_test_suite(args: RunTestSuiteArgs) -> Result<serde_json::Value, String> {
    let RunTestSuiteArgs {
        id,
        test_types,
        test_configs,
    } = args;
    let registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    let registrar_config = registrars
        .iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "Registrar not found".to_string())?;

    // Decrypt password
    let password = CredentialStore::decrypt_password(&registrar_config.password)
        .map_err(|e| format!("Failed to decrypt password: {}", e))?;

    let mut config_with_password = registrar_config.clone();
    config_with_password.password = password;

    // Convert string test types to enum
    let test_types_enum: Vec<TestType> = test_types
        .iter()
        .filter_map(|t| match t.as_str() {
            "basic_registration" => Some(TestType::BasicRegistration),
            "reregistration" => Some(TestType::Reregistration),
            "deregistration" => Some(TestType::Deregistration),
            "network_connectivity" => Some(TestType::NetworkConnectivity),
            "transport_validation" => Some(TestType::TransportValidation),
            "expires_header" => Some(TestType::ExpiresHeader),
            "contact_header" => Some(TestType::ContactHeader),
            "error_handling" => Some(TestType::ErrorHandling),
            "nat_traversal" => Some(TestType::NatTraversal),
            "firewall_test" => Some(TestType::FirewallTest),
            "dns_srv_test" => Some(TestType::DnsSrvTest),
            "registration_stability" => Some(TestType::RegistrationStability),
            "network_conditions" => Some(TestType::NetworkConditions),
            "multi_transport" => Some(TestType::MultiTransport),
            _ => None,
        })
        .collect();

    // Parse test configs if provided
    let mut configs_map = std::collections::HashMap::new();
    if let Some(configs_json) = test_configs {
        if let Some(configs_obj) = configs_json.as_object() {
            for (test_type_str, config_json) in configs_obj {
                let test_type_enum = match test_type_str.as_str() {
                    "basic_registration" => TestType::BasicRegistration,
                    "reregistration" => TestType::Reregistration,
                    "deregistration" => TestType::Deregistration,
                    "network_connectivity" => TestType::NetworkConnectivity,
                    "transport_validation" => TestType::TransportValidation,
                    "expires_header" => TestType::ExpiresHeader,
                    "contact_header" => TestType::ContactHeader,
                    "error_handling" => TestType::ErrorHandling,
                    "nat_traversal" => TestType::NatTraversal,
                    "firewall_test" => TestType::FirewallTest,
                    "dns_srv_test" => TestType::DnsSrvTest,
                    "registration_stability" => TestType::RegistrationStability,
                    "network_conditions" => TestType::NetworkConditions,
                    "multi_transport" => TestType::MultiTransport,
                    _ => continue,
                };
                if let Ok(config) =
                    serde_json::from_value::<crate::sip::tests::TestConfig>(config_json.clone())
                {
                    configs_map.insert(test_type_enum, config);
                }
            }
        }
    }

    let suite_result = TestSuite::run_suite(&config_with_password, &test_types_enum, &configs_map)
        .map_err(|e| format!("Test suite failed: {}", e))?;

    // Save test results to database for health reports
    let suite_result_json = serde_json::to_value(&suite_result)
        .map_err(|e| format!("Failed to serialize result: {}", e))?;

    // Save the entire test suite result
    match Database::save_test_result(&id, "test_suite", &suite_result_json, None) {
        Ok(_) => {
            tracing::info!("Successfully saved test suite result for registrar {}", id);
        }
        Err(e) => {
            tracing::error!(
                "ERROR: Failed to save test suite result for registrar {}: {}",
                id,
                e
            );
        }
    }

    // Also save individual test results for easier parsing
    if let Some(suite_obj) = suite_result_json.as_object() {
        if let Some(tests) = suite_obj.get("tests").and_then(|t| t.as_array()) {
            for test in tests {
                if let Some(test_obj) = test.as_object() {
                    // Get test type from the test object
                    let test_type_str = test_obj
                        .get("test_type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");

                    // Save individual test result
                    let diagnostics = test_obj.get("diagnostics").and_then(|d| {
                        if d.is_null() {
                            None
                        } else {
                            Some(d)
                        }
                    });

                    Database::save_test_result(&id, test_type_str, test, diagnostics)
                        .unwrap_or_else(|e| {
                            tracing::error!("Failed to save individual test result: {}", e);
                        });
                }
            }
        }
    }

    Ok(suite_result_json)
}

#[derive(Debug, Deserialize)]
pub(crate) struct BulkTestRegistrarsArgs {
    ids: Vec<String>,
    #[serde(rename = "testTypes")]
    test_types: Vec<String>,
}

#[command]
#[tracing::instrument(skip_all)]
pub fn bulk_test_registrars(args: BulkTestRegistrarsArgs) -> Result<serde_json::Value, String> {
    let BulkTestRegistrarsArgs { ids, test_types } = args;
    let registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    // Convert string test types to enum
    let test_types_enum: Vec<TestType> = test_types
        .iter()
        .filter_map(|t| match t.as_str() {
            "basic_registration" => Some(TestType::BasicRegistration),
            "reregistration" => Some(TestType::Reregistration),
            "deregistration" => Some(TestType::Deregistration),
            "network_connectivity" => Some(TestType::NetworkConnectivity),
            "transport_validation" => Some(TestType::TransportValidation),
            "expires_header" => Some(TestType::ExpiresHeader),
            "contact_header" => Some(TestType::ContactHeader),
            "error_handling" => Some(TestType::ErrorHandling),
            "nat_traversal" => Some(TestType::NatTraversal),
            "firewall_test" => Some(TestType::FirewallTest),
            "dns_srv_test" => Some(TestType::DnsSrvTest),
            "registration_stability" => Some(TestType::RegistrationStability),
            "network_conditions" => Some(TestType::NetworkConditions),
            "multi_transport" => Some(TestType::MultiTransport),
            _ => None,
        })
        .collect();

    let mut results = Vec::new();

    for id in ids {
        if let Some(registrar_config) = registrars.iter().find(|r| r.id == id) {
            // Decrypt password
            let password = CredentialStore::decrypt_password(&registrar_config.password)
                .map_err(|e| format!("Failed to decrypt password for {}: {}", id, e))?;

            let mut config_with_password = registrar_config.clone();
            config_with_password.password = password;

            // For bulk operations, use empty configs (could be extended to accept per-registrar configs)
            let empty_configs = std::collections::HashMap::new();
            match TestSuite::run_suite(&config_with_password, &test_types_enum, &empty_configs) {
                Ok(suite_result) => {
                    // Save test results to database
                    let suite_result_json = serde_json::to_value(&suite_result)
                        .map_err(|e| format!("Failed to serialize: {}", e))?;

                    // Save the entire test suite result
                    match Database::save_test_result(&id, "test_suite", &suite_result_json, None) {
                        Ok(_) => {
                            tracing::info!(
                                "Successfully saved test suite result for registrar {}",
                                id
                            );
                        }
                        Err(e) => {
                            tracing::error!(
                                "ERROR: Failed to save test suite result for registrar {}: {}",
                                id,
                                e
                            );
                        }
                    }

                    // Also save individual test results
                    if let Some(suite_obj) = suite_result_json.as_object() {
                        if let Some(tests) = suite_obj.get("tests").and_then(|t| t.as_array()) {
                            for test in tests {
                                if let Some(test_obj) = test.as_object() {
                                    let test_type_str = test_obj
                                        .get("test_type")
                                        .and_then(|t| t.as_str())
                                        .unwrap_or("unknown");

                                    let diagnostics = test_obj.get("diagnostics").and_then(|d| {
                                        if d.is_null() {
                                            None
                                        } else {
                                            Some(d)
                                        }
                                    });

                                    Database::save_test_result(
                                        &id,
                                        test_type_str,
                                        test,
                                        diagnostics,
                                    )
                                    .unwrap_or_else(|e| {
                                        tracing::error!(
                                            "Failed to save bulk individual test result: {}",
                                            e
                                        );
                                    });
                                }
                            }
                        }
                    }

                    results.push(serde_json::json!({
                        "registrar_id": id,
                        "success": suite_result.overall_success,
                        "result": suite_result
                    }));
                }
                Err(e) => {
                    results.push(serde_json::json!({
                        "registrar_id": id,
                        "success": false,
                        "error": e.to_string()
                    }));
                }
            }
        }
    }

    serde_json::to_value(&results).map_err(|e| format!("Failed to serialize results: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn bulk_register(ids: Vec<String>) -> Result<serde_json::Value, String> {
    let registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    let mut results = Vec::new();

    for id in ids {
        if let Some(registrar_config) = registrars.iter().find(|r| r.id == id) {
            // Decrypt password
            let password = CredentialStore::decrypt_password(&registrar_config.password)
                .map_err(|e| format!("Failed to decrypt password for {}: {}", id, e))?;

            let mut config_with_password = registrar_config.clone();
            config_with_password.password = password;

            match RegistrationTester::test_registration(&config_with_password) {
                Ok(result) => {
                    if is_registered_200(&result) {
                        crate::softphone::set_registration_binding(&config_with_password);
                    }
                    // Save test result to database so reports can track registration status
                    // Format matches TestResult structure: { success, result: { ... } }
                    let test_result = serde_json::json!({
                        "success": result.success,
                        "result": {
                            "success": result.success,
                            "status_code": result.status_code,
                            "status_text": result.status_text,
                            "response_time_ms": result.response_time_ms,
                            "expires": result.expires,
                            "error": result.error,
                            "request_message": result.request_message,
                            "response_message": result.response_message,
                        }
                    });

                    // Save as basic_registration test result
                    Database::save_test_result(&id, "basic_registration", &test_result, None)
                        .unwrap_or_else(|e| {
                            tracing::error!("Failed to save registration test result: {}", e);
                        });

                    results.push(serde_json::json!({
                        "registrar_id": id,
                        "success": result.success,
                        "status_code": result.status_code,
                        "status_text": result.status_text,
                        "response_time_ms": result.response_time_ms
                    }));
                }
                Err(e) => {
                    // Save failed result too - format matches TestResult structure
                    let test_result = serde_json::json!({
                        "success": false,
                        "result": {
                            "success": false,
                            "status_code": 0,
                            "status_text": "Error",
                            "response_time_ms": 0,
                            "error": e.to_string(),
                        }
                    });

                    Database::save_test_result(&id, "basic_registration", &test_result, None)
                        .unwrap_or_else(|err| {
                            tracing::error!(
                                "Failed to save failed registration test result: {}",
                                err
                            );
                        });

                    results.push(serde_json::json!({
                        "registrar_id": id,
                        "success": false,
                        "error": e.to_string()
                    }));
                }
            }
        }
    }

    serde_json::to_value(&results).map_err(|e| format!("Failed to serialize results: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn unregister_registrar(id: String) -> Result<serde_json::Value, String> {
    let registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    if let Some(registrar_config) = registrars.iter().find(|r| r.id == id) {
        // Decrypt password
        let password = CredentialStore::decrypt_password(&registrar_config.password)
            .map_err(|e| format!("Failed to decrypt password for {}: {}", id, e))?;

        let mut config_with_password = registrar_config.clone();
        config_with_password.password = password;

        // Deregister with Expires: 0
        match RegistrationTester::test_registration_with_expires(&config_with_password, 0) {
            Ok(result) => {
                if result.success && result.status_code >= 200 && result.status_code < 300 {
                    crate::softphone::clear_registration_binding(&id);
                }
                // Save test result to database so reports can track unregistration
                let test_result = serde_json::json!({
                    "success": result.success,
                    "result": {
                        "success": result.success,
                        "status_code": result.status_code,
                        "status_text": result.status_text,
                        "response_time_ms": result.response_time_ms,
                        "expires": result.expires,
                        "error": result.error,
                        "request_message": result.request_message,
                        "response_message": result.response_message,
                    }
                });

                Database::save_test_result(&id, "deregistration", &test_result, None)
                    .unwrap_or_else(|e| {
                        tracing::error!("Failed to save unregistration test result: {}", e);
                    });

                // Also save as basic_registration with success=false to mark as unregistered
                let unregistered_result = serde_json::json!({
                    "success": false,
                    "result": {
                        "success": false,
                        "status_code": result.status_code,
                        "status_text": result.status_text,
                        "response_time_ms": result.response_time_ms,
                        "expires": result.expires,
                        "error": result.error,
                        "unregistered": true,
                    }
                });

                Database::save_test_result(&id, "basic_registration", &unregistered_result, None)
                    .unwrap_or_else(|e| {
                        tracing::error!("Failed to save unregistered status: {}", e);
                    });

                Ok(serde_json::json!({
                    "registrar_id": id,
                    "success": result.success,
                    "status_code": result.status_code,
                    "status_text": result.status_text
                }))
            }
            Err(e) => {
                // Save failed result
                let test_result = serde_json::json!({
                    "success": false,
                    "result": {
                        "success": false,
                        "status_code": 0,
                        "status_text": "Error",
                        "response_time_ms": 0,
                        "error": e.to_string(),
                    }
                });

                Database::save_test_result(&id, "deregistration", &test_result, None)
                    .unwrap_or_else(|err| {
                        tracing::error!(
                            "Failed to save failed unregistration test result: {}",
                            err
                        );
                    });

                Err(format!("Unregistration failed: {}", e))
            }
        }
    } else {
        Err(format!("Registrar with id {} not found", id))
    }
}

#[command]
#[tracing::instrument(skip_all)]
pub fn bulk_unregister(ids: Vec<String>) -> Result<serde_json::Value, String> {
    let registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    let mut results = Vec::new();

    for id in ids {
        if let Some(registrar_config) = registrars.iter().find(|r| r.id == id) {
            // Decrypt password
            let password = CredentialStore::decrypt_password(&registrar_config.password)
                .map_err(|e| format!("Failed to decrypt password for {}: {}", id, e))?;

            let mut config_with_password = registrar_config.clone();
            config_with_password.password = password;

            // Deregister with Expires: 0
            match RegistrationTester::test_registration_with_expires(&config_with_password, 0) {
                Ok(result) => {
                    if result.success && result.status_code >= 200 && result.status_code < 300 {
                        crate::softphone::clear_registration_binding(&id);
                    }
                    // Save test result to database so reports can track unregistration
                    // Format matches TestResult structure
                    let test_result = serde_json::json!({
                        "success": result.success,
                        "result": {
                            "success": result.success,
                            "status_code": result.status_code,
                            "status_text": result.status_text,
                            "response_time_ms": result.response_time_ms,
                            "expires": result.expires,
                            "error": result.error,
                            "request_message": result.request_message,
                            "response_message": result.response_message,
                        }
                    });

                    Database::save_test_result(&id, "deregistration", &test_result, None)
                        .unwrap_or_else(|e| {
                            tracing::error!("Failed to save unregistration test result: {}", e);
                        });

                    // Also save as basic_registration with success=false to mark as unregistered
                    // Format matches TestResult structure
                    let unregistered_result = serde_json::json!({
                        "success": false,
                        "result": {
                            "success": false,
                            "status_code": result.status_code,
                            "status_text": result.status_text,
                            "response_time_ms": result.response_time_ms,
                            "expires": result.expires,
                            "error": result.error,
                            "unregistered": true,
                        }
                    });

                    Database::save_test_result(
                        &id,
                        "basic_registration",
                        &unregistered_result,
                        None,
                    )
                    .unwrap_or_else(|e| {
                        tracing::error!("Failed to save unregistered status: {}", e);
                    });

                    results.push(serde_json::json!({
                        "registrar_id": id,
                        "success": result.success,
                        "status_code": result.status_code,
                        "status_text": result.status_text
                    }));
                }
                Err(e) => {
                    // Save failed result - format matches TestResult structure
                    let test_result = serde_json::json!({
                        "success": false,
                        "result": {
                            "success": false,
                            "status_code": 0,
                            "status_text": "Error",
                            "response_time_ms": 0,
                            "error": e.to_string(),
                        }
                    });

                    Database::save_test_result(&id, "deregistration", &test_result, None)
                        .unwrap_or_else(|err| {
                            tracing::error!(
                                "Failed to save failed unregistration test result: {}",
                                err
                            );
                        });

                    results.push(serde_json::json!({
                        "registrar_id": id,
                        "success": false,
                        "error": e.to_string()
                    }));
                }
            }
        }
    }

    serde_json::to_value(&results).map_err(|e| format!("Failed to serialize results: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_registration_health() -> Result<serde_json::Value, String> {
    use crate::core::database::Database;

    let registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    let mut registrar_healths = Vec::new();
    let mut total_response_time = 0u64;
    let mut total_tests = 0usize;
    let mut successful_tests = 0usize;
    let mut last_successful_registration: Option<String> = None;

    for registrar in &registrars {
        // Load recent test results for this registrar
        let test_results =
            Database::load_test_results(Some(&registrar.id), Some(100)).unwrap_or_default();

        let mut registrar_response_times = Vec::new();
        let mut registrar_successful = 0usize;
        let mut registrar_total = 0usize;
        let mut registrar_registered = false;
        let mut registrar_last_test: Option<String> = None;
        let mut registrar_last_success: Option<String> = None;
        let mut latest_registration_test: Option<(String, bool, u64)> = None; // (timestamp, success, status_code)

        // Parse test results
        for result_json in &test_results {
            if let Some(result_obj) = result_json.as_object() {
                // Extract timestamp if available
                let timestamp = result_obj
                    .get("_timestamp")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());

                if timestamp.is_some() {
                    if registrar_last_test.is_none()
                        || timestamp.as_ref().unwrap() > registrar_last_test.as_ref().unwrap()
                    {
                        registrar_last_test = timestamp.clone();
                    }
                }

                // Try to extract test suite result or single test result
                if let Some(tests) = result_obj.get("tests").and_then(|t| t.as_array()) {
                    // Test suite result
                    for test in tests {
                        if let Some(test_obj) = test.as_object() {
                            if let Some(success) = test_obj.get("success").and_then(|s| s.as_bool())
                            {
                                registrar_total += 1;
                                if success {
                                    registrar_successful += 1;
                                    if timestamp.is_some() {
                                        if registrar_last_success.is_none()
                                            || timestamp.as_ref().unwrap()
                                                > registrar_last_success.as_ref().unwrap()
                                        {
                                            registrar_last_success = timestamp.clone();
                                        }
                                    }
                                }

                                if let Some(result) =
                                    test_obj.get("result").and_then(|r| r.as_object())
                                {
                                    if let Some(response_time) =
                                        result.get("response_time_ms").and_then(|rt| rt.as_u64())
                                    {
                                        registrar_response_times.push(response_time);
                                        total_response_time += response_time;
                                    }
                                    // Track registration tests to determine current registered status
                                    let test_type_str = test_obj
                                        .get("test_type")
                                        .and_then(|t| t.as_str())
                                        .unwrap_or("");

                                    // Handle both enum format (basic_registration) and string format
                                    let is_basic_registration = test_type_str
                                        == "basic_registration"
                                        || test_type_str == "BasicRegistration";

                                    if is_basic_registration {
                                        if let Some(status_code) =
                                            result.get("status_code").and_then(|sc| sc.as_u64())
                                        {
                                            if let Some(ts) = timestamp.clone() {
                                                // Only 200 OK means registered for SIP REGISTER
                                                let is_registered = success && status_code == 200;
                                                if latest_registration_test.is_none()
                                                    || ts
                                                        > latest_registration_test
                                                            .as_ref()
                                                            .unwrap()
                                                            .0
                                                {
                                                    latest_registration_test =
                                                        Some((ts, is_registered, status_code));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else if let Some(success) = result_obj.get("success").and_then(|s| s.as_bool()) {
                    // Single test result
                    registrar_total += 1;
                    if success {
                        registrar_successful += 1;
                        if timestamp.is_some() {
                            if registrar_last_success.is_none()
                                || timestamp.as_ref().unwrap()
                                    > registrar_last_success.as_ref().unwrap()
                            {
                                registrar_last_success = timestamp.clone();
                            }
                        }
                    }

                    // Check if it's a TestResult structure
                    if let Some(result) = result_obj.get("result").and_then(|r| r.as_object()) {
                        if let Some(response_time) =
                            result.get("response_time_ms").and_then(|rt| rt.as_u64())
                        {
                            registrar_response_times.push(response_time);
                            total_response_time += response_time;
                        }
                        // Track registration tests to determine current registered status
                        let test_type_str = result_obj
                            .get("_test_type")
                            .and_then(|t| t.as_str())
                            .unwrap_or("");

                        // Handle both enum format and string format
                        let is_basic_registration = test_type_str == "basic_registration"
                            || test_type_str == "BasicRegistration";

                        if is_basic_registration {
                            // Try to get status_code from nested result or direct
                            let status_code = result
                                .get("status_code")
                                .and_then(|sc| sc.as_u64())
                                .or_else(|| {
                                    result_obj.get("status_code").and_then(|sc| sc.as_u64())
                                });

                            if let Some(sc) = status_code {
                                if let Some(ts) = timestamp.clone() {
                                    // Only 200 OK means registered for SIP REGISTER
                                    let is_registered = success && sc == 200;
                                    if latest_registration_test.is_none()
                                        || ts > latest_registration_test.as_ref().unwrap().0
                                    {
                                        latest_registration_test = Some((ts, is_registered, sc));
                                    }
                                }
                            } else if success {
                                // If no status code but success=true, check for error to determine if actually registered
                                let has_error = result
                                    .get("error")
                                    .and_then(|e| e.as_str())
                                    .map(|e| !e.is_empty())
                                    .unwrap_or(false);
                                let is_registered = !has_error;
                                if let Some(ts) = timestamp.clone() {
                                    if latest_registration_test.is_none()
                                        || ts > latest_registration_test.as_ref().unwrap().0
                                    {
                                        latest_registration_test = Some((ts, is_registered, 200));
                                    }
                                }
                            }
                        }
                    } else {
                        // Direct result fields
                        if let Some(response_time) = result_obj
                            .get("response_time_ms")
                            .and_then(|rt| rt.as_u64())
                        {
                            registrar_response_times.push(response_time);
                            total_response_time += response_time;
                        }
                        // Track registration tests to determine current registered status
                        // Check for any registration-related test (basic_registration, registration_stability, etc.)
                        let test_type_str = result_obj
                            .get("_test_type")
                            .and_then(|t| t.as_str())
                            .unwrap_or("");

                        // Check if this is a basic registration test (most important for status)
                        let is_basic_registration = test_type_str == "basic_registration"
                            || test_type_str == "BasicRegistration";

                        if is_basic_registration {
                            // Try multiple ways to get status code
                            let status_code = result_obj
                                .get("status_code")
                                .and_then(|sc| sc.as_u64())
                                .or_else(|| {
                                    // Also check in nested result object
                                    result_obj
                                        .get("result")
                                        .and_then(|r| r.as_object())
                                        .and_then(|ro| ro.get("status_code"))
                                        .and_then(|sc| sc.as_u64())
                                });

                            if let Some(ts) = timestamp.clone() {
                                // Determine if registered: For SIP REGISTER, only 200 OK means successful registration
                                // RFC 3261: 200 OK is the only success response for REGISTER
                                let is_registered = if let Some(sc) = status_code {
                                    // Only 200 OK means registered. Other 2xx are rare for REGISTER and shouldn't be considered registered
                                    success && sc == 200
                                } else {
                                    // If no status code but success=true, check if there's an error indicating failure
                                    // If there's an error message, it's likely not registered
                                    let has_error = result_obj
                                        .get("result")
                                        .and_then(|r| r.as_object())
                                        .and_then(|ro| ro.get("error"))
                                        .and_then(|e| e.as_str())
                                        .map(|e| !e.is_empty())
                                        .unwrap_or(false);
                                    success && !has_error
                                };

                                if latest_registration_test.is_none()
                                    || ts > latest_registration_test.as_ref().unwrap().0
                                {
                                    latest_registration_test =
                                        Some((ts, is_registered, status_code.unwrap_or(0)));
                                }
                            }
                        }
                    }
                }
            }
        }

        total_tests += registrar_total;
        successful_tests += registrar_successful;

        // Determine registered status from most recent basic_registration test
        if let Some((_, is_registered, _)) = latest_registration_test {
            registrar_registered = is_registered;
        }

        // Calculate health score for this registrar
        // Only calculate if there are actual test results
        let avg_response_time = if !registrar_response_times.is_empty() {
            registrar_response_times.iter().sum::<u64>() as f64
                / registrar_response_times.len() as f64
        } else {
            0.0
        };

        let pass_rate = if registrar_total > 0 {
            (registrar_successful as f64 / registrar_total as f64) * 100.0
        } else {
            0.0
        };

        let health_score = if registrar_total > 0 {
            // Weighted scoring:
            // - Registration stability: 40% (registered = 100, not registered = 0)
            // - Test pass rate: 35% (actual percentage of tests passing)
            // - Response time: 25% (based on response time performance)
            let stability_score = if registrar_registered { 100.0 } else { 0.0 };

            // Response time scoring: penalize missing data less harshly, reward fast responses
            let response_time_score = if avg_response_time == 0.0 {
                75.0 // Missing data gets neutral score instead of dragging down
            } else if avg_response_time < 100.0 {
                100.0
            } else if avg_response_time < 300.0 {
                85.0
            } else if avg_response_time < 1000.0 {
                65.0
            } else {
                40.0
            };

            (stability_score * 0.40) + (pass_rate * 0.35) + (response_time_score * 0.25)
        } else {
            0.0 // No tests = no health score
        };

        let network_quality = if registrar_total > 0 {
            if avg_response_time < 100.0 {
                "excellent"
            } else if avg_response_time < 300.0 {
                "good"
            } else if avg_response_time < 1000.0 {
                "fair"
            } else {
                "poor"
            }
        } else {
            "unknown"
        };

        // Only include health score if there are actual test results
        let health_score_value = if registrar_total > 0 {
            Some(health_score.round() as u64)
        } else {
            None
        };

        registrar_healths.push(serde_json::json!({
            "registrar_id": registrar.id,
            "registered": registrar_registered,
            "health_score": health_score_value,
            "last_test_time": registrar_last_test,
            "response_time_ms": if avg_response_time > 0.0 { Some(avg_response_time.round() as u64) } else { None },
            "uptime_percentage": if registrar_total > 0 { Some(pass_rate) } else { None },
            "test_pass_rate": if registrar_total > 0 { Some(pass_rate / 100.0) } else { None },
            "network_quality": network_quality,
        }));

        if registrar_last_success.is_some() {
            if last_successful_registration.is_none()
                || registrar_last_success.as_ref().unwrap()
                    > last_successful_registration.as_ref().unwrap()
            {
                last_successful_registration = registrar_last_success;
            }
        }
    }

    // Calculate aggregate metrics
    let avg_response_time = if total_tests > 0 {
        Some(total_response_time / total_tests as u64)
    } else {
        None
    };

    let test_success_rate = if total_tests > 0 {
        Some(successful_tests as f64 / total_tests as f64)
    } else {
        None
    };

    let overall_network_quality = if let Some(avg_rt) = avg_response_time {
        if avg_rt < 100 {
            "excellent"
        } else if avg_rt < 300 {
            "good"
        } else if avg_rt < 1000 {
            "fair"
        } else {
            "poor"
        }
    } else {
        "unknown"
    };

    // Build test history and collect data for status analysis
    let mut test_history = Vec::new();
    let mut recent_results = Vec::new();

    // Track test type status across all registrars
    let mut test_type_status_map: HashMap<String, Vec<(String, bool, String)>> = HashMap::new(); // test_type -> [(registrar_id, success, timestamp)]

    for registrar in &registrars {
        let test_results =
            Database::load_test_results(Some(&registrar.id), Some(100)).unwrap_or_default();

        for result_json in &test_results {
            if let Some(result_obj) = result_json.as_object() {
                let timestamp = result_obj
                    .get("_timestamp")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());
                let test_type = result_obj
                    .get("_test_type")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());

                // Extract success and response time
                let mut success = false;
                let mut response_time = 0u64;

                if let Some(tests) = result_obj.get("tests").and_then(|t| t.as_array()) {
                    // Test suite - process individual tests
                    for test in tests {
                        if let Some(test_obj) = test.as_object() {
                            let test_success = test_obj
                                .get("success")
                                .and_then(|s| s.as_bool())
                                .unwrap_or(false);
                            let _test_type_str = test_obj
                                .get("test_type")
                                .and_then(|t| t.as_str())
                                .unwrap_or("");

                            if let Some(result) = test_obj.get("result").and_then(|r| r.as_object())
                            {
                                if let Some(rt) =
                                    result.get("response_time_ms").and_then(|rt| rt.as_u64())
                                {
                                    response_time = rt;
                                }
                            }

                            if let (Some(ts), Some(tt)) = (timestamp.clone(), test_type.clone()) {
                                if !tt.is_empty() {
                                    test_type_status_map
                                        .entry(tt.clone())
                                        .or_insert_with(Vec::new)
                                        .push((registrar.id.clone(), test_success, ts.clone()));

                                    recent_results.push(serde_json::json!({
                                        "timestamp": ts,
                                        "registrar_id": registrar.id,
                                        "registrar_name": registrar.name,
                                        "test_type": tt,
                                        "status": if test_success { "pass" } else { "fail" },
                                        "response_time_ms": response_time
                                    }));
                                }
                            }
                        }
                    }

                    // Use overall success for test history
                    if let Some(overall_success) =
                        result_obj.get("overall_success").and_then(|s| s.as_bool())
                    {
                        success = overall_success;
                    }
                    // Get average response time from tests
                    let mut total_rt = 0u64;
                    let mut count = 0usize;
                    for test in tests {
                        if let Some(test_obj) = test.as_object() {
                            if let Some(result) = test_obj.get("result").and_then(|r| r.as_object())
                            {
                                if let Some(rt) =
                                    result.get("response_time_ms").and_then(|rt| rt.as_u64())
                                {
                                    total_rt += rt;
                                    count += 1;
                                }
                            }
                        }
                    }
                    if count > 0 {
                        response_time = total_rt / count as u64;
                    }
                } else if let Some(s) = result_obj.get("success").and_then(|s| s.as_bool()) {
                    success = s;
                    if let Some(result) = result_obj.get("result").and_then(|r| r.as_object()) {
                        if let Some(rt) = result.get("response_time_ms").and_then(|rt| rt.as_u64())
                        {
                            response_time = rt;
                        }
                    } else if let Some(rt) = result_obj
                        .get("response_time_ms")
                        .and_then(|rt| rt.as_u64())
                    {
                        response_time = rt;
                    }

                    // Track single test result
                    if let (Some(ts), Some(tt)) = (timestamp.clone(), test_type.clone()) {
                        if !tt.is_empty() {
                            test_type_status_map
                                .entry(tt.clone())
                                .or_insert_with(Vec::new)
                                .push((registrar.id.clone(), success, ts.clone()));

                            recent_results.push(serde_json::json!({
                                "timestamp": ts,
                                "registrar_id": registrar.id,
                                "registrar_name": registrar.name,
                                "test_type": tt,
                                "status": if success { "pass" } else { "fail" },
                                "response_time_ms": response_time
                            }));
                        }
                    }
                }

                if let (Some(ts), Some(tt)) = (timestamp, test_type) {
                    test_history.push(serde_json::json!({
                        "timestamp": ts,
                        "success": success,
                        "response_time_ms": response_time,
                        "test_type": tt,
                        "registrar_id": registrar.id
                    }));
                }
            }
        }
    }

    // Sort by timestamp descending
    test_history.sort_by(|a, b| {
        let ts_a = a.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
        let ts_b = b.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
        ts_b.cmp(ts_a)
    });

    // Limit to most recent 100
    test_history.truncate(100);

    // Sort recent results by timestamp descending
    recent_results.sort_by(|a, b| {
        let ts_a = a.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
        let ts_b = b.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
        ts_b.cmp(ts_a)
    });

    // Limit recent results to 50
    recent_results.truncate(50);

    // Build test type status array
    let mut test_type_status = Vec::new();
    for (test_type, registrar_statuses) in test_type_status_map {
        // Determine overall status
        let has_fail = registrar_statuses.iter().any(|(_, success, _)| !success);
        let has_pass = registrar_statuses.iter().any(|(_, success, _)| *success);
        let latest = registrar_statuses
            .iter()
            .max_by(|a, b| a.2.cmp(&b.2))
            .map(|(_, _, ts)| ts.clone());

        let overall_status = if registrar_statuses.is_empty() {
            "not_tested"
        } else if has_fail && !has_pass {
            "fail"
        } else if has_pass && !has_fail {
            "pass"
        } else {
            "warning" // Mixed results
        };

        test_type_status.push(serde_json::json!({
            "test_type": test_type,
            "status": overall_status,
            "last_run": latest,
            "registrar_statuses": registrar_statuses.iter().map(|(reg_id, success, ts)| {
                serde_json::json!({
                    "registrar_id": reg_id,
                    "status": if *success { "pass" } else { "fail" },
                    "last_run": ts
                })
            }).collect::<Vec<_>>()
        }));
    }

    // Build time series data (group by hour for last 7 days)
    let mut time_series_data = Vec::new();
    let now = chrono::Utc::now();
    let seven_days_ago = now - chrono::Duration::hours(168);

    // Group test history by hour
    let mut hourly_data: HashMap<String, (usize, usize, u64, usize)> = HashMap::new(); // hour -> (success_count, total_count, total_rt, count)

    for entry in &test_history {
        if let Some(ts_str) = entry.get("timestamp").and_then(|t| t.as_str()) {
            if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                if ts.timestamp() >= seven_days_ago.timestamp() {
                    let hour_key = format!("{}", ts.format("%Y-%m-%dT%H:00:00Z"));
                    let success = entry
                        .get("success")
                        .and_then(|s| s.as_bool())
                        .unwrap_or(false);
                    let rt = entry
                        .get("response_time_ms")
                        .and_then(|rt| rt.as_u64())
                        .unwrap_or(0);

                    let entry = hourly_data.entry(hour_key).or_insert((0, 0, 0, 0));
                    entry.1 += 1; // total
                    if success {
                        entry.0 += 1; // success
                    }
                    entry.2 += rt;
                    entry.3 += 1;
                }
            }
        }
    }

    for (period, (success_count, total_count, total_rt, count)) in hourly_data {
        let success_rate = if total_count > 0 {
            success_count as f64 / total_count as f64
        } else {
            0.0
        };
        let avg_response_time = if count > 0 {
            total_rt / count as u64
        } else {
            0
        };

        time_series_data.push(serde_json::json!({
            "period": period,
            "success_rate": success_rate,
            "avg_response_time": avg_response_time
        }));
    }

    // Sort time series by period
    time_series_data.sort_by(|a, b| {
        let period_a = a.get("period").and_then(|p| p.as_str()).unwrap_or("");
        let period_b = b.get("period").and_then(|p| p.as_str()).unwrap_or("");
        period_a.cmp(period_b)
    });

    let result = serde_json::json!({
        "registrars": registrar_healths,
        "metrics": {
            "average_response_time": avg_response_time,
            "test_success_rate": test_success_rate,
            "last_successful_registration": last_successful_registration,
            "network_quality": overall_network_quality,
        },
        "test_history": test_history,
        "test_type_status": test_type_status,
        "recent_results": recent_results,
        "time_series_data": time_series_data,
    });

    Ok(result)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn clear_test_results(registrar_id: Option<String>) -> Result<usize, String> {
    use crate::core::database::Database;

    Database::clear_test_results(registrar_id.as_deref())
        .map_err(|e| format!("Failed to clear test results: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn get_test_suite_results(
    registrar_id: String,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    use crate::core::database::Database;
    use rusqlite::params;

    let limit = limit.unwrap_or(50);

    // Query directly for test_suite results to avoid loading all test results
    let conn = Database::get_connection()
        .map_err(|e| format!("Failed to get database connection: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT result, timestamp, test_type FROM test_results 
         WHERE registrar_id = ?1 AND test_type = 'test_suite' 
         ORDER BY timestamp DESC LIMIT ?2",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut suite_results = Vec::new();
    let rows = stmt
        .query_map(params![registrar_id, limit], |row| {
            let result_json: String = row.get(0)?;
            let timestamp: String = row.get(1)?;
            let test_type: String = row.get(2)?;
            let mut result_value: serde_json::Value =
                serde_json::from_str(&result_json).map_err(|_| {
                    rusqlite::Error::InvalidColumnType(
                        0,
                        "Invalid JSON in test result".to_string(),
                        rusqlite::types::Type::Text,
                    )
                })?;
            // Add timestamp and test_type to the result
            if let Some(obj) = result_value.as_object_mut() {
                obj.insert("_timestamp".to_string(), serde_json::json!(timestamp));
                obj.insert("_test_type".to_string(), serde_json::json!(test_type));
            }
            Ok(result_value)
        })
        .map_err(|e| format!("Failed to execute query: {}", e))?;

    for row in rows {
        match row {
            Ok(result_value) => {
                suite_results.push(result_value);
            }
            Err(e) => {
                return Err(format!("Failed to read row: {}", e));
            }
        }
    }

    Ok(suite_results)
}

#[command]
#[tracing::instrument(skip_all)]
pub async fn export_test_results(
    registrar_ids: Option<Vec<String>>,
    format: String,
    _file_path: Option<String>,
) -> Result<String, String> {
    use crate::core::database::Database;
    use std::fs;

    let extension = if format == "html" { "html" } else { "pdf" };
    let default_filename = format!(
        "registration_report_{}.{}",
        chrono::Utc::now().format("%Y%m%d_%H%M%S"),
        extension
    );

    let dialog_result = rfd::AsyncFileDialog::new()
        .set_title("Save Registration Report")
        .set_file_name(&default_filename)
        .add_filter(&format!("{} files", format.to_uppercase()), &[extension])
        .save_file()
        .await;

    let final_path = match dialog_result {
        Some(handle) => handle.path().to_path_buf(),
        None => return Err("File save dialog was cancelled".to_string()),
    };

    // Get health data
    let health_data =
        get_registration_health().map_err(|e| format!("Failed to get health data: {}", e))?;

    let registrars =
        Database::load_registrars().map_err(|e| format!("Failed to load registrars: {}", e))?;

    // Filter registrars if IDs provided
    let filtered_registrars: Vec<_> = if let Some(ids) = registrar_ids {
        registrars.iter().filter(|r| ids.contains(&r.id)).collect()
    } else {
        registrars.iter().collect()
    };

    match format.as_str() {
        "html" => {
            // Generate HTML report
            let html = generate_html_report(&health_data, &filtered_registrars);

            fs::write(&final_path, html)
                .map_err(|e| format!("Failed to write HTML file: {}", e))?;

            Ok(format!("Report exported to: {}", final_path.display()))
        }
        "pdf" => {
            // Generate PDF report
            let pdf_bytes = generate_pdf_report(&health_data, &filtered_registrars)
                .map_err(|e| format!("Failed to generate PDF: {}", e))?;

            fs::write(&final_path, pdf_bytes)
                .map_err(|e| format!("Failed to write PDF file: {}", e))?;

            Ok(format!("Report exported to: {}", final_path.display()))
        }
        _ => Err(format!("Unsupported format: {}", format)),
    }
}

fn generate_html_report(
    health_data: &serde_json::Value,
    registrars: &[&crate::core::config::RegistrarConfig],
) -> String {
    let empty_vec: Vec<serde_json::Value> = Vec::new();
    let registrars_json = health_data
        .get("registrars")
        .and_then(|r| r.as_array())
        .unwrap_or(&empty_vec);
    let empty_map = serde_json::Map::new();
    let metrics = health_data
        .get("metrics")
        .and_then(|m| m.as_object())
        .unwrap_or(&empty_map);

    let mut html = String::from(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Registration Health Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background: #0a0a0a; color: #e5e5e5; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #fff; border-bottom: 2px solid #333; padding-bottom: 10px; }
        h2 { color: #fff; margin-top: 30px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .metric-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 15px; }
        .metric-label { color: #999; font-size: 0.9em; }
        .metric-value { color: #fff; font-size: 1.5em; font-weight: bold; margin-top: 5px; }
        .registrar-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 15px; margin: 10px 0; }
        .registrar-header { display: flex; justify-content: space-between; align-items: center; }
        .health-score { font-size: 1.8em; font-weight: bold; }
        .health-good { color: #22c55e; }
        .health-fair { color: #eab308; }
        .health-poor { color: #ef4444; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 0.85em; }
        .status-registered { background: #22c55e; color: #000; }
        .status-not-registered { background: #ef4444; color: #fff; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
        th { background: #1a1a1a; color: #fff; font-weight: 600; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; color: #999; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Registration Health Report</h1>
        <p>Generated: "#,
    );

    html.push_str(&chrono::Utc::now().to_rfc3339());
    html.push_str(
        r#"</p>
        
        <h2>Overall Metrics</h2>
        <div class="metrics">"#,
    );

    if let Some(avg_rt) = metrics
        .get("average_response_time")
        .and_then(|v| v.as_u64())
    {
        html.push_str(&format!(
            r#"<div class="metric-card">
                <div class="metric-label">Average Response Time</div>
                <div class="metric-value">{}ms</div>
            </div>"#,
            avg_rt
        ));
    }

    if let Some(success_rate) = metrics.get("test_success_rate").and_then(|v| v.as_f64()) {
        html.push_str(&format!(
            r#"<div class="metric-card">
                <div class="metric-label">Test Success Rate</div>
                <div class="metric-value">{:.1}%</div>
            </div>"#,
            success_rate * 100.0
        ));
    }

    if let Some(network_quality) = metrics.get("network_quality").and_then(|v| v.as_str()) {
        html.push_str(&format!(
            r#"<div class="metric-card">
                <div class="metric-label">Network Quality</div>
                <div class="metric-value">{}</div>
            </div>"#,
            network_quality
        ));
    }

    html.push_str(
        r#"</div>
        
        <h2>Registrar Health</h2>"#,
    );

    for registrar_health in registrars_json {
        if let Some(reg_id) = registrar_health
            .get("registrar_id")
            .and_then(|v| v.as_str())
        {
            if let Some(registrar) = registrars.iter().find(|r| r.id == reg_id) {
                let health_score = registrar_health
                    .get("health_score")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let registered = registrar_health
                    .get("registered")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let response_time = registrar_health
                    .get("response_time_ms")
                    .and_then(|v| v.as_u64());

                let health_class = if health_score >= 80 {
                    "health-good"
                } else if health_score >= 60 {
                    "health-fair"
                } else {
                    "health-poor"
                };

                html.push_str(&format!(
                    r#"
            <div class="registrar-card">
                <div class="registrar-header">
                    <div>
                        <h3>{}</h3>
                        <p style="color: #999; margin-top: 5px;">{}</p>
                    </div>
                    <div>
                        <div class="health-score {}">{}</div>
                        <span class="status-badge {}">{}</span>
                    </div>
                </div>"#,
                    registrar.name,
                    registrar.domain,
                    health_class,
                    health_score,
                    if registered {
                        "status-registered"
                    } else {
                        "status-not-registered"
                    },
                    if registered {
                        "Registered"
                    } else {
                        "Not Registered"
                    }
                ));

                if let Some(rt) = response_time {
                    html.push_str(&format!(
                        r#"<p style="margin-top: 10px; color: #999;">Response Time: {}ms</p>"#,
                        rt
                    ));
                }

                html.push_str("</div>");
            }
        }
    }

    html.push_str(
        r#"
        <div class="footer">
            <p>VoIP Toolset - Registration Health Report</p>
        </div>
    </div>
</body>
</html>"#,
    );

    html
}

fn generate_pdf_report(
    health_data: &serde_json::Value,
    registrars: &[&crate::core::config::RegistrarConfig],
) -> Result<Vec<u8>, String> {
    use printpdf::*;
    use std::io::{BufWriter, Cursor, Write};

    let empty_vec: Vec<serde_json::Value> = Vec::new();
    let registrars_json = health_data
        .get("registrars")
        .and_then(|r| r.as_array())
        .unwrap_or(&empty_vec);
    let empty_map = serde_json::Map::new();
    let metrics = health_data
        .get("metrics")
        .and_then(|m| m.as_object())
        .unwrap_or(&empty_map);

    // Create a new PDF document
    let (doc, page1, layer1) = PdfDocument::new(
        "Registration Health Report",
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );
    let current_page_ref = doc.get_page(page1);
    let current_layer = current_page_ref.get_layer(layer1);
    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("Failed to add font: {}", e))?;
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| format!("Failed to add bold font: {}", e))?;

    let mut y_position = 280.0;
    let left_margin = 20.0;
    let line_height = 12.0;
    let mut current_page = page1;
    let mut current_layer_index = layer1;

    // Title
    current_layer.use_text(
        "Registration Health Report",
        24.0,
        Mm(left_margin),
        Mm(y_position),
        &font_bold,
    );
    y_position -= 20.0;

    // Generated date
    let generated_date = chrono::Utc::now()
        .format("%Y-%m-%d %H:%M:%S UTC")
        .to_string();
    current_layer.use_text(
        &format!("Generated: {}", generated_date),
        10.0,
        Mm(left_margin),
        Mm(y_position),
        &font,
    );
    y_position -= 20.0;

    // Overall Metrics section
    current_layer.use_text(
        "Overall Metrics",
        16.0,
        Mm(left_margin),
        Mm(y_position),
        &font_bold,
    );
    y_position -= 15.0;

    if let Some(avg_rt) = metrics
        .get("average_response_time")
        .and_then(|v| v.as_u64())
    {
        current_layer.use_text(
            &format!("Average Response Time: {}ms", avg_rt),
            10.0,
            Mm(left_margin),
            Mm(y_position),
            &font,
        );
        y_position -= line_height;
    }

    if let Some(success_rate) = metrics.get("test_success_rate").and_then(|v| v.as_f64()) {
        current_layer.use_text(
            &format!("Test Success Rate: {:.1}%", success_rate * 100.0),
            10.0,
            Mm(left_margin),
            Mm(y_position),
            &font,
        );
        y_position -= line_height;
    }

    if let Some(network_quality) = metrics.get("network_quality").and_then(|v| v.as_str()) {
        current_layer.use_text(
            &format!("Network Quality: {}", network_quality),
            10.0,
            Mm(left_margin),
            Mm(y_position),
            &font,
        );
        y_position -= line_height;
    }

    y_position -= 10.0;

    // Registrar Health section
    current_layer.use_text(
        "Registrar Health",
        16.0,
        Mm(left_margin),
        Mm(y_position),
        &font_bold,
    );
    y_position -= 15.0;

    for registrar_health in registrars_json {
        // Check if we need a new page
        if y_position < 30.0 {
            let (new_page, new_layer) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
            current_page = new_page;
            current_layer_index = new_layer;
            y_position = 280.0;
        }

        let page_ref = doc.get_page(current_page);
        let layer = page_ref.get_layer(current_layer_index);

        if let Some(reg_id) = registrar_health
            .get("registrar_id")
            .and_then(|v| v.as_str())
        {
            if let Some(registrar) = registrars.iter().find(|r| r.id == reg_id) {
                let health_score = registrar_health
                    .get("health_score")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let registered = registrar_health
                    .get("registered")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let response_time = registrar_health
                    .get("response_time_ms")
                    .and_then(|v| v.as_u64());

                // Registrar name
                layer.use_text(
                    &registrar.name,
                    12.0,
                    Mm(left_margin),
                    Mm(y_position),
                    &font_bold,
                );
                y_position -= line_height;

                // Domain
                layer.use_text(
                    &registrar.domain,
                    10.0,
                    Mm(left_margin + 5.0),
                    Mm(y_position),
                    &font,
                );
                y_position -= line_height;

                // Health score and status
                layer.use_text(
                    &format!("Health Score: {}", health_score),
                    10.0,
                    Mm(left_margin + 5.0),
                    Mm(y_position),
                    &font,
                );
                y_position -= line_height;

                layer.use_text(
                    &format!(
                        "Status: {}",
                        if registered {
                            "Registered"
                        } else {
                            "Not Registered"
                        }
                    ),
                    10.0,
                    Mm(left_margin + 5.0),
                    Mm(y_position),
                    &font,
                );
                y_position -= line_height;

                if let Some(rt) = response_time {
                    layer.use_text(
                        &format!("Response Time: {}ms", rt),
                        10.0,
                        Mm(left_margin + 5.0),
                        Mm(y_position),
                        &font,
                    );
                    y_position -= line_height;
                }

                y_position -= 10.0;
            }
        }
    }

    // Footer on last page
    let page_ref = doc.get_page(current_page);
    let layer = page_ref.get_layer(current_layer_index);
    layer.use_text(
        "VoIP Toolset - Registration Health Report",
        8.0,
        Mm(left_margin),
        Mm(20.0),
        &font,
    );

    // Convert to bytes using Cursor and BufWriter
    let mut buffer = Vec::new();
    {
        let cursor = Cursor::new(&mut buffer);
        let mut writer = BufWriter::new(cursor);
        doc.save(&mut writer)
            .map_err(|e| format!("Failed to save PDF: {}", e))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush PDF buffer: {}", e))?;
    }

    Ok(buffer)
}

// ── Registrar Folder Commands ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrarFolder {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
}

#[command]
#[tracing::instrument(skip_all)]
pub fn list_registrar_folders() -> Result<Vec<RegistrarFolder>, String> {
    let rows =
        Database::load_registrar_folders().map_err(|e| format!("Failed to load folders: {}", e))?;
    Ok(rows
        .into_iter()
        .map(|(id, name, sort_order, created_at)| RegistrarFolder {
            id,
            name,
            sort_order,
            created_at,
        })
        .collect())
}

#[command]
#[tracing::instrument(skip_all)]
pub fn create_registrar_folder(name: String) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    // Default sort_order: after all existing folders
    let existing =
        Database::load_registrar_folders().map_err(|e| format!("Failed to load folders: {}", e))?;
    let max_order = existing.iter().map(|(_, _, o, _)| *o).max().unwrap_or(-1);
    Database::save_registrar_folder(&id, &name, max_order + 1, &now)
        .map_err(|e| format!("Failed to create folder: {}", e))?;
    Ok(id)
}

#[command]
#[tracing::instrument(skip_all)]
pub fn rename_registrar_folder(id: String, name: String) -> Result<(), String> {
    Database::rename_registrar_folder(&id, &name)
        .map_err(|e| format!("Failed to rename folder: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn delete_registrar_folder(id: String) -> Result<(), String> {
    Database::delete_registrar_folder(&id).map_err(|e| format!("Failed to delete folder: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn reorder_registrar_folders(ids: Vec<String>) -> Result<(), String> {
    Database::reorder_registrar_folders(&ids)
        .map_err(|e| format!("Failed to reorder folders: {}", e))
}

#[command]
#[tracing::instrument(skip_all)]
pub fn reorder_registrars(ids: Vec<String>) -> Result<(), String> {
    Database::reorder_registrars(&ids).map_err(|e| format!("Failed to reorder registrars: {}", e))
}
