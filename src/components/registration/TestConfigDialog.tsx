import { useState, useEffect, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { AppDropdown, type AppDropdownOption } from "@/components/ui/app-dropdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Settings, HelpCircle } from "@/lib/icons";
import type { TestType } from "@/types/registration";
import { TEST_TYPES } from "@/types/registration";

const FORCE_TRANSPORT_OPTIONS: AppDropdownOption[] = [
  { value: "default", label: "Default" },
  { value: "udp", label: "UDP" },
  { value: "tcp", label: "TCP" },
  { value: "tls", label: "TLS" },
  { value: "wss", label: "WSS" },
];

const BOOL_YES_NO_OPTIONS: AppDropdownOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

const TLS_VERSION_OPTIONS: AppDropdownOption[] = [
  { value: "1.2", label: "TLS 1.2" },
  { value: "1.3", label: "TLS 1.3" },
];

export interface TestConfig {
  timeout_seconds?: number;
  expires_values?: number[];
  concurrent_requests?: number;
  invalid_credentials?: boolean;
  delay_between_registrations_ms?: number;
  test_tcp?: boolean;
  test_udp?: boolean;
  test_dns?: boolean;
  test_port_range?: boolean;
  test_packet_sizes?: boolean;
  test_rate_limiting?: boolean;
  test_stateful_firewall?: boolean;
  test_sip_aware?: boolean;
  // DNS/Network options
  dns_resolver?: string; // Custom DNS server (e.g., "8.8.8.8" or "1.1.1.1")
  network_interface?: string; // Network interface to bind to
  local_port_override?: number; // Override local port for this test
  remote_port_override?: number; // Override remote port for this test
  // Transport options
  force_transport?: "udp" | "tcp" | "tls" | "wss";
  tcp_keepalive?: boolean;
  tcp_nodelay?: boolean;
  udp_buffer_size?: number;
  // Retry options
  retry_count?: number;
  retry_delay_ms?: number;
  // Registration options
  custom_expires?: number;
  custom_contact_header?: string;
  custom_user_agent?: string;
  custom_call_id?: string;
  custom_from_tag?: string;
  custom_cseq?: number;
  custom_max_forwards?: number;
  custom_request_uri?: string;
  // SIP Protocol options
  sip_version?: string; // "2.0" is standard
  add_via_params?: string; // Additional Via header parameters
  add_contact_params?: string; // Additional Contact header parameters
  add_to_params?: string; // Additional To header parameters
  add_from_params?: string; // Additional From header parameters
  // Authentication options
  force_authentication?: boolean; // Force auth even if not required
  auth_algorithm?: "md5" | "sha256" | "sha512";
  custom_realm?: string;
  // Test-specific
  test_srv_records?: boolean;
  test_naptr_records?: boolean;
  simulate_packet_loss?: number; // 0-100 percentage
  simulate_latency_ms?: number;
  simulate_jitter_ms?: number; // Jitter simulation
  simulate_bandwidth_kbps?: number; // Bandwidth throttling
  // TLS/Security options
  tls_verify_certificate?: boolean;
  tls_verify_hostname?: boolean;
  tls_min_version?: "1.2" | "1.3";
  tls_cipher_suites?: string; // Comma-separated
  tls_sni?: string; // Server Name Indication
  // Network simulation
  mtu_size?: number;
  fragment_packets?: boolean;
  duplicate_packets?: boolean;
  duplicate_packet_rate?: number; // 0-100 percentage
  // Test execution
  test_iterations?: number; // Number of times to run test
  success_threshold?: number; // Percentage of successful runs required
  failure_threshold?: number; // Percentage of failures to stop test
  // Advanced
  custom_headers?: Array<{ name: string; value: string }>;
  [key: string]: unknown;
}

interface TestConfigDialogProps {
  testType: TestType;
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: TestConfig) => void;
  currentConfig?: TestConfig;
}

const defaultConfigs: Record<TestType, TestConfig> = {
  basic_registration: {
    timeout_seconds: 30,
  },
  reregistration: {
    timeout_seconds: 30,
    delay_between_registrations_ms: 500,
  },
  deregistration: {
    timeout_seconds: 30,
  },
  network_connectivity: {
    timeout_seconds: 5,
    test_tcp: true,
    test_dns: true,
  },
  transport_validation: {
    timeout_seconds: 30,
  },
  expires_header: {
    timeout_seconds: 30,
    expires_values: [60, 300, 3600],
  },
  contact_header: {
    timeout_seconds: 30,
  },
  error_handling: {
    timeout_seconds: 30,
    invalid_credentials: true,
  },
  nat_traversal: {
    timeout_seconds: 30,
  },
  dns_srv_test: {
    timeout_seconds: 10,
    test_dns: true,
  },
  registration_stability: {
    timeout_seconds: 30,
    delay_between_registrations_ms: 2000,
  },
  firewall_test: {
    timeout_seconds: 10,
  },
  network_conditions: {
    timeout_seconds: 30,
  },
  multi_transport: {
    timeout_seconds: 30,
  },
};

export function TestConfigDialog({
  testType,
  isOpen,
  onClose,
  onSave,
  currentConfig,
}: TestConfigDialogProps) {
  const testInfo = TEST_TYPES.find((t) => t.id === testType);
  const defaultConfig = defaultConfigs[testType] || {};
  const [config, setConfig] = useState<TestConfig>(currentConfig || defaultConfig);
  const [activeTab, setActiveTab] = useState<string>("basic");
  const [showAdvancedWarning, setShowAdvancedWarning] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setConfig(currentConfig || defaultConfig);
      setActiveTab("basic");
      setShowAdvancedWarning(false);
      setPendingTab(null);
    }
  }, [isOpen, currentConfig, testType]);

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  const handleTabChange = (value: string) => {
    if (value === "advanced") {
      setPendingTab("advanced");
      setShowAdvancedWarning(true);
    } else {
      setActiveTab(value);
    }
  };

  const handleAdvancedWarningConfirm = () => {
    setShowAdvancedWarning(false);
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  };

  const handleAdvancedWarningCancel = () => {
    setShowAdvancedWarning(false);
    setPendingTab(null);
  };

  const updateConfig = (key: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const LabelWithTooltip = ({ htmlFor, children, tooltip, entry, className }: { htmlFor?: string; children: ReactNode; tooltip?: string; entry?: { title: string; description?: string }; className?: string }) => (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor} className={className}>
        {children}
      </Label>
      <TooltipWrapper entry={entry} title={!entry ? tooltip : undefined}>
        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
      </TooltipWrapper>
    </div>
  );

  const renderConfigFields = () => {
    switch (testType) {
      case "basic_registration":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for a response from the registrar before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="retry_count" entry={tooltips.regTestConfigRetries} className="text-xs">
                Retry Attempts
              </LabelWithTooltip>
              <Input
                id="retry_count"
                type="number"
                min="0"
                max="10"
                value={config.retry_count || 0}
                onChange={(e) => updateConfig("retry_count", parseInt(e.target.value) || 0)}
                className="h-8 text-sm"
              />
            </div>
            {config.retry_count && config.retry_count > 0 && (
              <div className="space-y-1.5">
                <LabelWithTooltip htmlFor="retry_delay" entry={tooltips.regTestConfigRetryDelay} className="text-xs">
                  Retry Delay (ms)
                </LabelWithTooltip>
                <Input
                  id="retry_delay"
                  type="number"
                  min="100"
                  max="10000"
                  value={config.retry_delay_ms || 1000}
                  onChange={(e) => updateConfig("retry_delay_ms", parseInt(e.target.value) || 1000)}
                  className="h-8 text-sm"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="force_transport" tooltip="Override the transport protocol for this test. Default uses the registrar's configured transport" className="text-xs">
                Transport
              </LabelWithTooltip>
              <AppDropdown
                value={(config.force_transport as string) || "default"}
                onValueChange={(value) => updateConfig("force_transport", value === "default" ? undefined : value)}
                options={FORCE_TRANSPORT_OPTIONS}
                placeholder="Default"
                className="h-8 text-sm"
                size="sm"
              />
            </div>
          </div>
        );

      case "deregistration":
      case "contact_header":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="timeout" className="text-xs">Timeout (seconds)</Label>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom_contact_header" className="text-xs">Contact Format</Label>
              <Input
                id="custom_contact_header"
                type="text"
                placeholder="Default"
                value={(config.custom_contact_header as string) || ""}
                onChange={(e) => updateConfig("custom_contact_header", e.target.value || undefined)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        );

      case "transport_validation":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for a response from the registrar before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="force_transport" tooltip="Transport protocol to test. This overrides the registrar's default transport for this test" className="text-xs">
                Transport
              </LabelWithTooltip>
              <AppDropdown
                value={(config.force_transport as string) || "default"}
                onValueChange={(value) => updateConfig("force_transport", value === "default" ? undefined : value)}
                options={FORCE_TRANSPORT_OPTIONS}
                placeholder="Default"
                className="h-8 text-sm"
                size="sm"
              />
            </div>
          </div>
        );

      case "reregistration":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for a response from the registrar before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="delay" tooltip="Delay in milliseconds between the first and second registration attempt. Simulates periodic refresh behavior" className="text-xs">
                Delay Between (ms)
              </LabelWithTooltip>
              <Input
                id="delay"
                type="number"
                min="0"
                max="10000"
                value={(config.delay_between_registrations_ms as number) || 500}
                onChange={(e) => updateConfig("delay_between_registrations_ms", parseInt(e.target.value) || 500)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        );

      case "network_connectivity":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for network connectivity tests to complete" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="60"
                value={config.timeout_seconds || 5}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 5)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="test_tcp"
                checked={(config.test_tcp as boolean) ?? true}
                onChange={(e) => updateConfig("test_tcp", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="test_tcp" className="cursor-pointer text-xs">
                  Test TCP Connectivity
                </Label>
                <TooltipWrapper content="Test if a TCP connection can be established to the registrar's host and port">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="test_dns"
                checked={(config.test_dns as boolean) ?? true}
                onChange={(e) => updateConfig("test_dns", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="test_dns" className="cursor-pointer text-xs">
                  Test DNS Resolution
                </Label>
                <TooltipWrapper content="Test if the registrar's hostname can be resolved to an IP address">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="dns_resolver" tooltip="Custom DNS server IP address to use for resolution (e.g., 8.8.8.8, 1.1.1.1). Leave empty to use system default DNS" className="text-xs">
                DNS Resolver
              </LabelWithTooltip>
              <Input
                id="dns_resolver"
                type="text"
                placeholder="8.8.8.8 (optional)"
                value={(config.dns_resolver as string) || ""}
                onChange={(e) => updateConfig("dns_resolver", e.target.value || undefined)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        );

      case "expires_header":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for a response from the registrar before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="expires" tooltip="Comma-separated list of Expires header values (in seconds) to test. The test will send REGISTER requests with each value" className="text-xs">
                Expires Values (comma-separated)
              </LabelWithTooltip>
              <Input
                id="expires"
                type="text"
                placeholder="60, 300, 3600"
                value={(config.expires_values as number[])?.join(", ") || "60, 300, 3600"}
                onChange={(e) => {
                  const values = e.target.value
                    .split(",")
                    .map((v) => parseInt(v.trim()))
                    .filter((v) => !isNaN(v));
                  updateConfig("expires_values", values);
                }}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="custom_expires" tooltip="Default Expires header value to use if not specified in the expires values list" className="text-xs">
                Default Expires (seconds)
              </LabelWithTooltip>
              <Input
                id="custom_expires"
                type="number"
                min="0"
                max="4294967295"
                placeholder="3600"
                value={config.custom_expires || ""}
                onChange={(e) => updateConfig("custom_expires", e.target.value ? parseInt(e.target.value) : undefined)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        );

      case "error_handling":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for a response from the registrar before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="invalid_credentials"
                checked={(config.invalid_credentials as boolean) ?? true}
                onChange={(e) => updateConfig("invalid_credentials", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="invalid_credentials" className="cursor-pointer text-xs">
                  Use Invalid Credentials
                </Label>
                <TooltipWrapper content="Intentionally use incorrect credentials to test how the registrar handles authentication failures and error responses">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="test_iterations_error" tooltip="Number of different error scenarios to test (invalid credentials, malformed requests, etc.)" className="text-xs">
                Error Scenarios
              </LabelWithTooltip>
              <Input
                id="test_iterations_error"
                type="number"
                min="1"
                max="10"
                value={config.test_iterations || 1}
                onChange={(e) => updateConfig("test_iterations", parseInt(e.target.value) || 1)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        );

      case "nat_traversal":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for a response from the registrar before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="network_interface" tooltip="Specific network interface to bind to (e.g., eth0, en0, wlan0). Leave empty for auto-detection. Useful for NAT detection when multiple interfaces are available" className="text-xs">
                Network Interface
              </LabelWithTooltip>
              <Input
                id="network_interface"
                type="text"
                placeholder="eth0, en0 (optional)"
                value={(config.network_interface as string) || ""}
                onChange={(e) => updateConfig("network_interface", e.target.value || undefined)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        );

      case "firewall_test":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for port connectivity tests before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="60"
                value={config.timeout_seconds || 10}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 10)}
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="test_tcp_firewall"
                  checked={(config.test_tcp as boolean) ?? true}
                  onChange={(e) => updateConfig("test_tcp", e.target.checked)}
                  className="rounded border-border h-4 w-4"
                />
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="test_tcp_firewall" className="cursor-pointer text-xs">
                    Test TCP
                  </Label>
                  <TooltipWrapper content="Test TCP port connectivity (5060, 5061, 80, 443)">
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipWrapper>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="test_udp_firewall"
                  checked={(config.test_udp as boolean) ?? true}
                  onChange={(e) => updateConfig("test_udp", e.target.checked)}
                  className="rounded border-border h-4 w-4"
                />
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="test_udp_firewall" className="cursor-pointer text-xs">
                    Test UDP
                  </Label>
                  <TooltipWrapper content="Test UDP port connectivity (5060, 3478 for STUN)">
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipWrapper>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="test_port_range"
                checked={(config.test_port_range as boolean) ?? false}
                onChange={(e) => updateConfig("test_port_range", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="test_port_range" className="cursor-pointer text-xs">
                  Test Port Range
                </Label>
                <TooltipWrapper content="Test a range of ports to identify which are blocked">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="test_packet_sizes"
                checked={(config.test_packet_sizes as boolean) ?? false}
                onChange={(e) => updateConfig("test_packet_sizes", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="test_packet_sizes" className="cursor-pointer text-xs">
                  Test Packet Sizes
                </Label>
                <TooltipWrapper content="Test different packet sizes to detect MTU restrictions or fragmentation issues">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="test_rate_limiting"
                checked={(config.test_rate_limiting as boolean) ?? false}
                onChange={(e) => updateConfig("test_rate_limiting", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="test_rate_limiting" className="cursor-pointer text-xs">
                  Test Rate Limiting
                </Label>
                <TooltipWrapper content="Send multiple rapid requests to detect firewall rate limiting or DDoS protection">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="test_stateful_firewall"
                checked={(config.test_stateful_firewall as boolean) ?? false}
                onChange={(e) => updateConfig("test_stateful_firewall", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="test_stateful_firewall" className="cursor-pointer text-xs">
                  Test Stateful Firewall
                </Label>
                <TooltipWrapper content="Test if firewall tracks connection state (allows return traffic for established connections)">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="test_sip_aware"
                checked={(config.test_sip_aware as boolean) ?? false}
                onChange={(e) => updateConfig("test_sip_aware", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="test_sip_aware" className="cursor-pointer text-xs">
                  Test SIP-Aware Firewall
                </Label>
                <TooltipWrapper content="Test if firewall performs deep packet inspection on SIP traffic">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
          </div>
        );

      case "network_conditions":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for a response from the registrar before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <LabelWithTooltip htmlFor="simulate_latency" tooltip="Simulate network latency by adding artificial delay to requests. 0 = no simulation" className="text-xs">
                  Latency (ms)
                </LabelWithTooltip>
                <Input
                  id="simulate_latency"
                  type="number"
                  min="0"
                  max="5000"
                  value={config.simulate_latency_ms || 0}
                  onChange={(e) => updateConfig("simulate_latency_ms", parseInt(e.target.value) || 0)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <LabelWithTooltip htmlFor="simulate_packet_loss" tooltip="Simulate packet loss percentage (0-100). Higher values test reliability under poor network conditions" className="text-xs">
                  Packet Loss (%)
                </LabelWithTooltip>
                <Input
                  id="simulate_packet_loss"
                  type="number"
                  min="0"
                  max="100"
                  value={config.simulate_packet_loss || 0}
                  onChange={(e) => updateConfig("simulate_packet_loss", parseInt(e.target.value) || 0)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>
        );

      case "multi_transport":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for a response from the registrar before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="force_transport" tooltip="Primary transport to test. The test will also attempt fallback transports (e.g., UDP if TCP fails)" className="text-xs">
                Primary Transport
              </LabelWithTooltip>
              <AppDropdown
                value={(config.force_transport as string) || "default"}
                onValueChange={(value) => updateConfig("force_transport", value === "default" ? undefined : value)}
                options={FORCE_TRANSPORT_OPTIONS}
                placeholder="Default"
                className="h-8 text-sm"
                size="sm"
              />
            </div>
          </div>
        );

      case "dns_srv_test":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for DNS resolution to complete" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="60"
                value={config.timeout_seconds || 10}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 10)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="test_dns"
                checked={(config.test_dns as boolean) ?? true}
                onChange={(e) => updateConfig("test_dns", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="test_dns" className="cursor-pointer text-xs">
                  Test DNS Resolution
                </Label>
                <TooltipWrapper content="Test basic DNS resolution of the registrar hostname to IP address">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="dns_resolver" tooltip="Custom DNS server for SRV/NAPTR record lookup (e.g., 8.8.8.8, 1.1.1.1). Leave empty to use system default" className="text-xs">
                DNS Resolver
              </LabelWithTooltip>
              <Input
                id="dns_resolver"
                type="text"
                placeholder="8.8.8.8 (optional)"
                value={(config.dns_resolver as string) || ""}
                onChange={(e) => updateConfig("dns_resolver", e.target.value || undefined)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="test_srv"
                checked={(config.test_srv_records as boolean) ?? false}
                onChange={(e) => updateConfig("test_srv_records", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="test_srv" className="cursor-pointer text-xs">
                  Test SRV Records
                </Label>
                <TooltipWrapper content="Test DNS SRV records (_sip._udp, _sip._tcp) for service discovery and failover">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="test_naptr"
                checked={(config.test_naptr_records as boolean) ?? false}
                onChange={(e) => updateConfig("test_naptr_records", e.target.checked)}
                className="rounded border-border h-4 w-4"
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="test_naptr" className="cursor-pointer text-xs">
                  Test NAPTR Records
                </Label>
                <TooltipWrapper content="Test DNS NAPTR records for service discovery and transport selection">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipWrapper>
              </div>
            </div>
          </div>
        );

      case "registration_stability":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for each registration attempt before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <LabelWithTooltip htmlFor="delay" tooltip="Delay in milliseconds between consecutive registration attempts" className="text-xs">
                  Delay (ms)
                </LabelWithTooltip>
                <Input
                  id="delay"
                  type="number"
                  min="0"
                  max="10000"
                  value={(config.delay_between_registrations_ms as number) || 2000}
                  onChange={(e) => updateConfig("delay_between_registrations_ms", parseInt(e.target.value) || 2000)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <LabelWithTooltip htmlFor="test_iterations_stability" tooltip="Number of consecutive registration attempts to test long-term stability" className="text-xs">
                  Attempts
                </LabelWithTooltip>
                <Input
                  id="test_iterations_stability"
                  type="number"
                  min="2"
                  max="50"
                  value={config.test_iterations || 3}
                  onChange={(e) => updateConfig("test_iterations", parseInt(e.target.value) || 3)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="success_threshold_stability" tooltip="Minimum percentage of successful registrations required to pass the test (0-100)" className="text-xs">
                Success Threshold (%)
              </LabelWithTooltip>
              <Input
                id="success_threshold_stability"
                type="number"
                min="0"
                max="100"
                value={config.success_threshold || 100}
                onChange={(e) => updateConfig("success_threshold", parseInt(e.target.value) || 100)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        );

      default:
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="timeout" tooltip="Maximum time to wait for a response from the registrar before timing out" className="text-xs">
                Timeout (seconds)
              </LabelWithTooltip>
              <Input
                id="timeout"
                type="number"
                min="1"
                max="300"
                value={config.timeout_seconds || 30}
                onChange={(e) => updateConfig("timeout_seconds", parseInt(e.target.value) || 30)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        );
    }
  };

  const renderAdvancedOptions = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <LabelWithTooltip htmlFor="local_port_override" tooltip="Override the local SIP port for this test. Leave empty to use the registrar's configured local port" className="text-xs">
            Local Port
          </LabelWithTooltip>
          <Input
            id="local_port_override"
            type="number"
            min="1024"
            max="65535"
            placeholder="Auto"
            value={config.local_port_override || ""}
            onChange={(e) => updateConfig("local_port_override", e.target.value ? parseInt(e.target.value) : undefined)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <LabelWithTooltip htmlFor="remote_port_override" tooltip="Override the remote registrar port for this test. Leave empty to use the registrar's configured remote port" className="text-xs">
            Remote Port
          </LabelWithTooltip>
          <Input
            id="remote_port_override"
            type="number"
            min="1"
            max="65535"
            placeholder="Auto"
            value={config.remote_port_override || ""}
            onChange={(e) => updateConfig("remote_port_override", e.target.value ? parseInt(e.target.value) : undefined)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <LabelWithTooltip htmlFor="custom_user_agent" tooltip="Override User-Agent for this test only. Leave empty to use app default from Settings (SIPalyzer version + OS, e.g. macOS 14.2.1; user when available)." className="text-xs">
          User-Agent
        </LabelWithTooltip>
        <Input
          id="custom_user_agent"
          type="text"
          placeholder="Default"
          value={(config.custom_user_agent as string) || ""}
          onChange={(e) => updateConfig("custom_user_agent", e.target.value || undefined)}
          className="h-8 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <LabelWithTooltip htmlFor="custom_cseq" tooltip="Initial CSeq (Command Sequence) value. Default is 1. CSeq increments with each request" className="text-xs">
            CSeq
          </LabelWithTooltip>
          <Input
            id="custom_cseq"
            type="number"
            min="1"
            placeholder="1"
            value={config.custom_cseq || ""}
            onChange={(e) => updateConfig("custom_cseq", e.target.value ? parseInt(e.target.value) : undefined)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <LabelWithTooltip htmlFor="custom_max_forwards" tooltip="Max-Forwards header value (0-255). Default is 70. Prevents infinite loops in SIP routing" className="text-xs">
            Max-Forwards
          </LabelWithTooltip>
          <Input
            id="custom_max_forwards"
            type="number"
            min="0"
            max="255"
            placeholder="70"
            value={config.custom_max_forwards || ""}
            onChange={(e) => updateConfig("custom_max_forwards", e.target.value ? parseInt(e.target.value) : undefined)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <LabelWithTooltip htmlFor="add_contact_params" tooltip="Additional parameters to append to the Contact header (e.g., ;expires=3600;q=1.0). Start with semicolon" className="text-xs">
          Contact Params
        </LabelWithTooltip>
        <Input
          id="add_contact_params"
          type="text"
          placeholder=";expires=3600"
          value={(config.add_contact_params as string) || ""}
          onChange={(e) => updateConfig("add_contact_params", e.target.value || undefined)}
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <LabelWithTooltip htmlFor="add_via_params" tooltip="Additional parameters to append to the Via header (e.g., ;rport;received). Start with semicolon" className="text-xs">
          Via Params
        </LabelWithTooltip>
        <Input
          id="add_via_params"
          type="text"
          placeholder=";rport;received"
          value={(config.add_via_params as string) || ""}
          onChange={(e) => updateConfig("add_via_params", e.target.value || undefined)}
          className="h-8 text-sm"
        />
      </div>

      {(testType === "multi_transport" || (config.force_transport && (config.force_transport === "tls" || config.force_transport === "wss"))) && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="tls_verify_certificate" tooltip="Verify the TLS certificate chain. Disable only for testing with self-signed certificates" className="text-xs">
                Verify Cert
              </LabelWithTooltip>
              <AppDropdown
                value={config.tls_verify_certificate === false ? "false" : "true"}
                onValueChange={(value) => updateConfig("tls_verify_certificate", value === "true")}
                options={BOOL_YES_NO_OPTIONS}
                className="h-8 text-sm"
                size="sm"
              />
            </div>
            <div className="space-y-1.5">
              <LabelWithTooltip htmlFor="tls_verify_hostname" tooltip="Verify that the certificate's hostname matches the registrar hostname. Disable only for testing" className="text-xs">
                Verify Hostname
              </LabelWithTooltip>
              <AppDropdown
                value={config.tls_verify_hostname === false ? "false" : "true"}
                onValueChange={(value) => updateConfig("tls_verify_hostname", value === "true")}
                options={BOOL_YES_NO_OPTIONS}
                className="h-8 text-sm"
                size="sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <LabelWithTooltip htmlFor="tls_min_version" tooltip="Minimum TLS version to accept. TLS 1.3 is more secure but may not be supported by all registrars" className="text-xs">
              TLS Version
            </LabelWithTooltip>
            <AppDropdown
              value={(config.tls_min_version as string) || "1.2"}
              onValueChange={(value) => updateConfig("tls_min_version", value)}
              options={TLS_VERSION_OPTIONS}
              className="h-8 text-sm"
              size="sm"
            />
          </div>
        </>
      )}

      {testType === "network_conditions" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <LabelWithTooltip htmlFor="simulate_jitter" tooltip="Simulate network jitter (variation in latency). Adds random delay variation to test reliability under unstable networks" className="text-xs">
              Jitter (ms)
            </LabelWithTooltip>
            <Input
              id="simulate_jitter"
              type="number"
              min="0"
              max="1000"
              value={config.simulate_jitter_ms || 0}
              onChange={(e) => updateConfig("simulate_jitter_ms", parseInt(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <LabelWithTooltip htmlFor="simulate_bandwidth" tooltip="Throttle bandwidth to simulate slow connections. 0 = unlimited bandwidth" className="text-xs">
              Bandwidth (Kbps)
            </LabelWithTooltip>
            <Input
              id="simulate_bandwidth"
              type="number"
              min="0"
              placeholder="Unlimited"
              value={config.simulate_bandwidth_kbps || ""}
              onChange={(e) => updateConfig("simulate_bandwidth_kbps", e.target.value ? parseInt(e.target.value) : undefined)}
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <LabelWithTooltip htmlFor="test_iterations" tooltip="Number of times to run this test. Useful for reliability testing and averaging results" className="text-xs">
            Iterations
          </LabelWithTooltip>
          <Input
            id="test_iterations"
            type="number"
            min="1"
            max="100"
            value={config.test_iterations || 1}
            onChange={(e) => updateConfig("test_iterations", parseInt(e.target.value) || 1)}
            className="h-8 text-sm"
          />
        </div>
        {config.test_iterations && config.test_iterations > 1 && (
          <div className="space-y-1.5">
            <LabelWithTooltip htmlFor="success_threshold" tooltip="Minimum percentage of successful test runs required to pass (0-100). 100% means all iterations must succeed" className="text-xs">
              Success %
            </LabelWithTooltip>
            <Input
              id="success_threshold"
              type="number"
              min="0"
              max="100"
              value={config.success_threshold || 100}
              onChange={(e) => updateConfig("success_threshold", parseInt(e.target.value) || 100)}
              className="h-8 text-sm"
            />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col">
        <DialogHeader className="pb-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            {testInfo?.label}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {testInfo?.description}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="subview-tabs-compact">
              <TabsTrigger value="basic" className="subview-tab-compact">Basic</TabsTrigger>
              <TabsTrigger value="advanced" className="subview-tab-compact">Advanced</TabsTrigger>
            </TabsList>
            <TabsContent value="basic" className="mt-4 space-y-3">
              {renderConfigFields()}
            </TabsContent>
            <TabsContent value="advanced" className="mt-4">
              {renderAdvancedOptions()}
            </TabsContent>
          </Tabs>
        </div>
        <ConfirmDialog
          open={showAdvancedWarning}
          onOpenChange={(open) => {
            if (!open) {
              handleAdvancedWarningCancel();
            } else {
              setShowAdvancedWarning(true);
            }
          }}
          title="Advanced Configuration Warning"
          description="Advanced options allow you to modify low-level SIP protocol settings, network parameters, and test behavior. Incorrect configuration may cause test failures or unexpected behavior. Only modify these settings if you understand their impact on SIP registration."
          confirmText="Continue"
          cancelText="Cancel"
          variant="neutral"
          onConfirm={handleAdvancedWarningConfirm}
        />
        <DialogFooter className="surface-subtle sticky bottom-0 z-10 pt-3 border-t border-border px-5 pb-3">
          <TooltipWrapper title="Cancel" description="Close without saving test configuration.">
            <Button variant="neutral" onClick={onClose} size="sm">
              Cancel
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="Save" description="Save test configuration and close.">
            <Button onClick={handleSave} size="sm">Save</Button>
          </TooltipWrapper>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
