export type TestType =
  | "basic_registration"
  | "reregistration"
  | "deregistration"
  | "network_connectivity"
  | "transport_validation"
  | "expires_header"
  | "contact_header"
  | "error_handling"
  | "nat_traversal"
  | "firewall_test"
  | "dns_srv_test"
  | "registration_stability"
  | "network_conditions"
  | "multi_transport";

export interface TestResult {
  test_type: TestType;
  success: boolean;
  result: {
    success: boolean;
    status_code: number;
    status_text: string;
    response_time_ms: number;
    expires?: number;
    error?: string;
    request_message: string;
    response_message: string;
    unregistered?: boolean;
  };
  diagnostics?: Record<string, unknown>;
}

export interface TestSuiteResult {
  registrar_id: string;
  tests: TestResult[];
  overall_success: boolean;
  total_tests: number;
  passed_tests: number;
  failed_tests: number;
}

export interface BulkOperationResult {
  registrar_id: string;
  success: boolean;
  status_code?: number;
  status_text?: string;
  response_time_ms?: number;
  error?: string;
  result?: TestSuiteResult;
}

export interface TestDiagnostics {
  [key: string]: unknown;
}

export const TEST_TYPES: Array<{
  id: TestType;
  label: string;
  description: string;
  category: "basic" | "network";
}> = [
  // Basic Category - Ordered by workflow
  {
    id: "network_connectivity",
    label: "Network Connectivity",
    description: "Tests DNS resolution and port accessibility",
    category: "basic",
  },
  {
    id: "basic_registration",
    label: "Basic Registration",
    description: "Standard REGISTER request with authentication",
    category: "basic",
  },
  {
    id: "contact_header",
    label: "Contact Header",
    description: "Tests contact header formats",
    category: "basic",
  },
  {
    id: "expires_header",
    label: "Expires Header",
    description: "Tests different expiration values",
    category: "basic",
  },
  {
    id: "reregistration",
    label: "Re-registration",
    description: "Tests periodic re-registration before expiration",
    category: "basic",
  },
  {
    id: "registration_stability",
    label: "Registration Stability",
    description: "Tests registration maintained over extended period with multiple attempts",
    category: "basic",
  },
  {
    id: "deregistration",
    label: "De-registration",
    description: "Tests graceful unregistration (Expires: 0)",
    category: "basic",
  },
  {
    id: "error_handling",
    label: "Error Handling",
    description: "Tests error response handling",
    category: "basic",
  },
  // Network Category - Ordered by workflow
  {
    id: "transport_validation",
    label: "Transport Validation",
    description: "Validates transport protocol (UDP/TCP/TLS/WSS)",
    category: "network",
  },
  {
    id: "dns_srv_test",
    label: "DNS SRV/NAPTR",
    description: "Tests DNS SRV record resolution for SIP failover discovery",
    category: "network",
  },
  {
    id: "nat_traversal",
    label: "NAT Traversal",
    description: "Tests registration behind NAT/firewall and detects NAT presence",
    category: "network",
  },
  {
    id: "multi_transport",
    label: "Multi-Transport",
    description: "Tests registration across different transports (UDP/TCP/TLS) and fallback behavior",
    category: "network",
  },
  {
    id: "network_conditions",
    label: "Network Conditions",
    description: "Tests registration under packet loss, latency, and poor network conditions",
    category: "network",
  },
];
