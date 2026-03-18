/**
 * Yealink provisioning field reference.
 * Only parameters with a specific entry here get a description and options; all others show "Unknown parameter".
 * Each entry: description = exactly what the parameter does; options = supported values only.
 */

/** Source citation for a parameter (Yealink or third-party docs). */
export interface FieldSource {
  name: string;
  url?: string;
}

export interface FieldInfo {
  label: string;
  description: string;
  category?: string;
  /** Valid values / options (e.g. "0 = Disabled, 1 = Enabled"). */
  options?: string;
  source?: FieldSource;
}

export interface FieldReferenceEntry {
  key: string | RegExp;
  label: string;
  description: string;
  category?: string;
  options?: string;
  source?: FieldSource;
}

/** Yealink Auto Provisioning Guide — boot files, CFG files, provisioning server (updated 2025/2026). */
const YEALINK_PROV_GUIDE: FieldSource = {
  name: "Yealink Auto Provisioning Guide",
  url: "https://support.yealink.com/en/portal/knowledge/show?id=66d181d2dffd1e178f9be955",
};

/** Yealink Remote Phonebook / directory configuration. */
const YEALINK_REMOTE_PHONEBOOK: FieldSource = {
  name: "Yealink Remote Phonebook",
  url: "https://support.yealink.com/en/portal/knowledge/show?id=64995b656a27da76bd07184a",
};

/** Yealink Line Keys (BLF, speed dial, programmable keys). */
const YEALINK_LINE_KEYS: FieldSource = {
  name: "Yealink Line Keys",
  url: "https://support.yealink.com/en/portal/knowledge/show?id=64995b6b6a27da76bd071939",
};

/** Yealink Dial Plan (prefix/replace, dial-now, area code). */
const YEALINK_DIAL_PLAN: FieldSource = {
  name: "Yealink Dial Plan",
  url: "https://support.yealink.com/en/portal/knowledge/show?id=64995b676a27da76bd071896",
};

/** Brekeke SIP Server Wiki — default local/common settings for Yealink (parameter tables). */
const BREKEKE_YEALINK: FieldSource = {
  name: "Brekeke — Default settings for Yealink provisioning",
  url: "https://docs.brekeke.com/sip/default-local-settings-for-yealink-provisioning",
};

/** Brekeke — common (shared) Yealink settings. */
const BREKEKE_COMMON: FieldSource = {
  name: "Brekeke — Default common settings for Yealink",
  url: "https://docs.brekeke.com/sip/default-common-settings-for-yealink-provisioning",
};

/** Yealink provisioning parameter reference. Order: more specific patterns first. */
export const YEALINK_FIELD_REFERENCE: FieldReferenceEntry[] = [
  // — Account (SIP lines) — full technical descriptions per Yealink/Brekeke docs
  {
    key: /^account\.\d+\.enable$/i,
    label: "Account enable",
    description: "Turns this SIP account (line) on or off. When disabled the line does not register and cannot make or receive calls; when enabled the phone registers and uses this account per the other account settings.",
    options: "0 = Disabled (line off, no registration), 1 = Enabled (line on, registers and can call)",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.display_name$/i,
    label: "Display name",
    description: "The name sent as caller ID and shown on the phone for this account. Sent in SIP From/To display name; this is what the other party sees when you call.",
    options: "Any string (e.g. user name or extension label); empty = use user_name or server default",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.label$/i,
    label: "Line label",
    description: "Short label shown on the phone LCD and line key for this account. Used only on the phone UI to identify the line (e.g. Line 1, Work); not sent in SIP.",
    options: "Any string (e.g. \"Line 1\", \"Work\", \"Mobile\"); empty = default label",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.line_key_name$/i,
    label: "Line key name",
    description: "Text shown on the DSS/line key for this account. Same idea as label but used in line-key/expansion-module context.",
    options: "Any string; empty = use label or default",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.user_name$/i,
    label: "User name",
    description: "SIP username (extension) used for registration and in SIP requests. Must match the extension configured on your SIP server for this account.",
    options: "Any string (extension or username); must match server; template {PHONE_ID} or {extension} often used",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.auth_name$/i,
    label: "Auth name",
    description: "Username used for SIP digest authentication. The phone uses this with the password when the server challenges REGISTER/INVITE. Usually same as user_name.",
    options: "Any string; typically same as user_name; empty = use user_name",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.password$/i,
    label: "Password",
    description: "SIP authentication password for this account. Used with auth_name for digest auth; must match the password for this extension on the SIP server.",
    options: "Any string (password); empty = no auth (unusual for registration)",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.register_name$/i,
    label: "Register name",
    description: "Username sent in the SIP REGISTER request (To header). In most setups same as user_name; some PBXs require a different value here.",
    options: "Any string; usually same as user_name or auth_name",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.sip_server_host$/i,
    label: "SIP server host",
    description: "IP or hostname of the SIP server for this account. The phone sends REGISTER and call signaling to this address (and sip_server_port).",
    options: "IPv4, IPv6, or hostname (e.g. sip.example.com); required for registration",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.sip_server_port$/i,
    label: "SIP server port",
    description: "Port the phone uses to reach the SIP server for this account. Must match the port the server listens on.",
    options: "1–65535; typical: 5060 (UDP/TCP), 5061 (TLS); default 5060",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.outbound_proxy_enable$/i,
    label: "Outbound proxy enable",
    description: "If enabled, all SIP traffic for this account goes to the outbound proxy (outbound_host:outbound_port) instead of directly to the SIP server. Use when you have a proxy/SBC in front of the server.",
    options: "0 = Disabled (send directly to SIP server), 1 = Enabled (send via outbound proxy)",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.outbound_host$/i,
    label: "Outbound proxy host",
    description: "IP or hostname of the outbound proxy. Used only when outbound_proxy_enable is 1; all SIP for this account is sent here first.",
    options: "IPv4, IPv6, or hostname; required when outbound proxy is enabled",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.outbound_port$/i,
    label: "Outbound proxy port",
    description: "Port of the outbound proxy. Used with outbound_host when outbound_proxy_enable is 1.",
    options: "1–65535; typical 5060",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.(transport|transport_type)$/i,
    label: "Transport",
    description: "Which protocol the phone uses for SIP on this account: UDP, TCP, TLS, or DNS-NAPTR. Must match what the server supports (use TLS for encrypted signaling).",
    options: "0 = UDP, 1 = TCP, 2 = TLS, 3 = DNS SRV / DNS-NAPTR",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.register$/i,
    label: "Register",
    description: "Whether the phone registers this account with the SIP server. If No, the account is unregistered (some systems still allow calls by IP/auth).",
    options: "0 = No (do not register), 1 = Yes (send REGISTER and keep binding)",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.sip_server\.\d+\.(address|host)$/i,
    label: "SIP server address",
    description: "IP or hostname for primary (.1) or secondary (.2) SIP server for this account. Works with the matching port and transport_type.",
    options: "IPv4, IPv6, or hostname; often {SIP_SERVER1} or {SIP_SERVER2} in templates",
    category: "Account",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^account\.\d+\.sip_server\.\d+\.port$/i,
    label: "SIP server port",
    description: "Port for this account's primary (.1) or secondary (.2) SIP server. Usually references {SIP_SERVER1_PORT} or {SIP_SERVER2_PORT} in templates.",
    options: "1–65535; typical 5060 (UDP/TCP), 5061 (TLS)",
    category: "Account",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^account\.\d+\.sip_server\.\d+\.transport_type$/i,
    label: "SIP server transport",
    description: "Which protocol to use for this SIP server (primary or secondary): UDP, TCP, TLS, or DNS-NAPTR. Must match the server.",
    options: "0 = UDP, 1 = TCP, 2 = TLS, 3 = DNS-NAPTR",
    category: "Account",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^account\.\d+\.codec\.\d+\.enable$/i,
    label: "Codec enable",
    description: "Turns this codec on or off for the account. If disabled the codec is not offered in SDP; if enabled it is used in the order given by codec.N.priority.",
    options: "0 = Disabled (not offered), 1 = Enabled (offered; order by priority)",
    category: "Account",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^account\.\d+\.codec\.\d+\.payload_type$/i,
    label: "Codec payload type",
    description: "Which audio codec this entry is. The phone offers these in SDP in priority order; both sides must support the chosen codec.",
    options: "PCMU | PCMA | G729 | G722 | G726-16 | G726-24 | G726-32 | G726-40 | iLBC | G723_53 | G723_63",
    category: "Account",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^account\.\d+\.codec\.\d+\.priority$/i,
    label: "Codec priority",
    description: "Order of this codec when negotiating (1 = first choice). Lower number = higher priority. Use to prefer e.g. G.722 over G.729.",
    options: "1–11 (1 = highest priority, 11 = lowest)",
    category: "Account",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^account\.\d+\.codec\.g722\.enable$/i,
    label: "G.722 codec enable",
    description: "Turns G.722 wideband codec on or off for this account. When enabled, the phone offers G.722 in SDP for higher-quality audio.",
    options: "0 = Disabled (not offered), 1 = Enabled (offered)",
    category: "Account",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^account\.\d+\.subscribe_mwi$/i,
    label: "Subscribe MWI",
    description: "Whether the phone subscribes to Message Waiting Indicator (MWI) for this account. When enabled, the phone receives voicemail/msg notifications from the server.",
    options: "0 = Disabled (no MWI subscription), 1 = Enabled (subscribe to MWI)",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.nat\.udp_update_enable$/i,
    label: "NAT UDP update enable",
    description: "Enables periodic UDP keepalive/update for this account when behind NAT. Keeps the NAT binding alive so incoming RTP/SIP reach the phone.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.nat\.udp_update_time$/i,
    label: "NAT UDP update interval",
    description: "Interval in seconds between NAT UDP keepalive/update packets for this account. Used when nat.udp_update_enable is 1.",
    options: "Positive integer (seconds); e.g. 20 = every 20 seconds",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.sip_server\.\d+\.expires$/i,
    label: "SIP server expires",
    description: "Registration expiry time in seconds for this SIP server. The phone re-registers before this expires to keep the binding alive.",
    options: "Positive integer (seconds); e.g. 3600 = 1 hour; typical 1800–7200",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.direct_pickup_code$/i,
    label: "Direct pickup code",
    description: "Feature access code for directed call pickup on this account. When you press a BLF key showing a ringing extension, the phone dials this code + extension to pick up the call.",
    options: "String (e.g. *97, **); empty = use global pickup code",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.reg_fail_retry_interval$/i,
    label: "Registration fail retry interval",
    description: "Seconds to wait before retrying registration after a failure. Helps avoid hammering the server when registration is rejected.",
    options: "Positive integer (seconds); e.g. 30, 60, 120",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  // — Network —
  {
    key: /^network\.(lan\.)?ip_address$/i,
    label: "IP address",
    description: "Static IPv4 address for the phone's LAN port. Used only when not using DHCP; use together with subnet_mask and gateway.",
    options: "IPv4 address (e.g. 192.168.1.100); empty or 0.0.0.0 = use DHCP",
    category: "Network",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^network\.(lan\.)?subnet_mask$/i,
    label: "Subnet mask",
    description: "Subnet mask when using static IP. Defines the local subnet; must match your network.",
    options: "e.g. 255.255.255.0 (/24); only used when static IP",
    category: "Network",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^network\.(lan\.)?gateway$/i,
    label: "Gateway",
    description: "Default gateway (router) when using static IP. Required for the phone to reach the internet and SIP server.",
    options: "IPv4 address (e.g. 192.168.1.1); only used when static IP",
    category: "Network",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^network\.(lan\.)?dns_primary$/i,
    label: "Primary DNS",
    description: "Primary DNS server for hostname resolution (SIP server, NTP, provisioning). Used when not provided by DHCP.",
    options: "IPv4 address (e.g. 8.8.8.8); empty = from DHCP if available",
    category: "Network",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^network\.(lan\.)?dns_secondary$/i,
    label: "Secondary DNS",
    description: "Fallback DNS server when the primary does not respond.",
    options: "IPv4 address; empty = no secondary",
    category: "Network",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^network\.(lan\.)?vlan_id$/i,
    label: "VLAN ID",
    description: "802.1Q VLAN ID. When set, the phone tags traffic with this VLAN (e.g. voice VLAN). Must match your switch.",
    options: "0 = no VLAN tagging, 1–4094 = VLAN ID",
    category: "Network",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^network\.ip_address_mode$/i,
    label: "IP address mode",
    description: "Whether the phone uses IPv4 only, IPv6 only, or both. When IPv6 or dual-stack, IPv6 parameters apply.",
    options: "0 = IPv4 only, 1 = IPv6 only, 2 = IPv4 and IPv6 (dual-stack)",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.internet_port\.type$/i,
    label: "Internet port type",
    description: "How the phone gets its IP: DHCP, PPPoE, or static. If static, you must set IP, mask, and gateway.",
    options: "0 = DHCP, 1 = PPPoE, 2 = Static IP",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.internet_port\.(ip|address)$/i,
    label: "Internet port IP",
    description: "Static IP for the main interface. Used only when internet_port.type is 2 (Static IP).",
    options: "IPv4 address; required when type = 2",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.internet_port\.(mask|subnet_mask)$/i,
    label: "Subnet mask",
    description: "Subnet mask for static IP (internet port). Used when type is 2.",
    options: "e.g. 255.255.255.0",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.internet_port\.gateway$/i,
    label: "Default gateway",
    description: "Default gateway when using static IP (internet port type 2).",
    options: "IPv4 address; required when type = 2",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.(primary_dns|dns_primary)$/i,
    label: "Primary DNS",
    description: "Primary DNS server. Used for resolving hostnames (SIP, NTP, provisioning).",
    options: "IPv4 address; empty = from DHCP",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.(secondary_dns|dns_secondary)$/i,
    label: "Secondary DNS",
    description: "Fallback DNS when primary is unreachable.",
    options: "IPv4 address; empty = no secondary",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.ipv6_prefix$/i,
    label: "IPv6 prefix length",
    description: "IPv6 prefix length for the LAN (e.g. /64). Used when ip_address_mode is 1 or 2.",
    options: "1–128; typical 64",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.ipv6_internet_port\.type$/i,
    label: "IPv6 internet port type",
    description: "How the phone gets its IPv6 address: DHCP or static.",
    options: "0 = DHCP, 1 = Static IP",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.ipv6_internet_port\.(ip|address)$/i,
    label: "IPv6 address",
    description: "Static IPv6 address for the main interface when IPv6 type is static.",
    options: "IPv6 address (e.g. 2001:db8::1); required when type = 1",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.ipv6_internet_port\.gateway$/i,
    label: "IPv6 gateway",
    description: "IPv6 default gateway when using static IPv6.",
    options: "IPv6 address; required when type = 1",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.ipv6_primary_dns$/i,
    label: "IPv6 primary DNS",
    description: "Primary DNS server for IPv6. Used when ip_address_mode is 1 or 2.",
    options: "IPv6 address; empty = from DHCP or none",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^network\.ipv6_secondary_dns$/i,
    label: "IPv6 secondary DNS",
    description: "Fallback IPv6 DNS when primary is unreachable.",
    options: "IPv6 address; empty = no secondary",
    category: "Network",
    source: BREKEKE_YEALINK,
  },
  // — Auto provisioning —
  {
    key: /^(static\.)?auto_provision\.server\.url$/i,
    label: "Provision server URL",
    description: "URL the phone uses to download the .cfg file when provisioning. The phone replaces {mac} in the URL with its MAC address (e.g. .../00156574b150.cfg). Use static. prefix so it survives factory reset.",
    options: "Full HTTP/HTTPS URL; may contain {mac} placeholder; required for auto provision",
    category: "Provisioning",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^(static\.)?auto_provision\.(aes_key_16\.mac|aes_key_in_file)$/i,
    label: "Provision encryption key",
    description: "AES key to decrypt encrypted .cfg files. If AES_KEY_IN_FILE is 0, config is plain text. AES_KEY_16.MAC is often a per-device 16-byte key.",
    options: "AES_KEY_IN_FILE: 0 = no encryption (plain .cfg); otherwise key value per server",
    category: "Provisioning",
    source: BREKEKE_COMMON,
  },
  {
    key: /^(static\.)?auto_provision\.server\.(username|password)$/i,
    label: "Provision server auth",
    description: "HTTP Basic auth username or password when the provisioning server requires login. The phone sends these when requesting the .cfg file.",
    options: "Any string; empty = no auth (if server allows)",
    category: "Provisioning",
    source: BREKEKE_COMMON,
  },
  {
    key: /^static\.auto_provision\.(custom\.)?protect$/i,
    label: "Provision protect",
    description: "Locks the provisioning URL so it cannot be changed from the phone UI. Use in managed deployments to prevent users changing the provision source.",
    options: "0 = Unlocked (URL editable on phone), 1 = Locked (URL cannot be changed)",
    category: "Provisioning",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^static\.auto_provision\.(user_agent_mac|ua_mac)/i,
    label: "User-Agent MAC",
    description: "If enabled, the phone puts its MAC in the HTTP User-Agent when requesting the .cfg file. Some servers use this to pick the right file or log the device.",
    options: "0 = No (MAC not in User-Agent), 1 = Yes (MAC in User-Agent)",
    category: "Provisioning",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^auto_provision\.local_contact\.backup\.enable$/i,
    label: "Local contact backup enable",
    description: "Enables automatic backup of the local phonebook/contacts to the provisioning server.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Provisioning",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^auto_provision\.local_contact\.backup\.path$/i,
    label: "Local contact backup path",
    description: "URL path where the phone uploads its local phonebook backup. The phone POSTs the contact data to this URL.",
    options: "HTTP/HTTPS URL path; empty = use default path",
    category: "Provisioning",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^firmware\.url$/i,
    label: "Firmware URL",
    description: "URL the phone uses to download firmware updates. Optional; used for central upgrade management.",
    options: "HTTP/HTTPS URL to firmware file or directory; empty = no auto firmware URL",
    category: "Provisioning",
    source: BREKEKE_COMMON,
  },
  {
    key: /^security\.trust_certificates$/i,
    label: "Trust certificates",
    description: "Whether the phone accepts custom/self-signed certificates (e.g. for HTTPS provisioning or TLS SIP). Enable only when you trust the custom CA.",
    options: "0 = Disabled (only standard CA certs), 1 = Enabled (accept custom/self-signed)",
    category: "Provisioning",
    source: BREKEKE_COMMON,
  },
  {
    key: /^wallpaper_upload\.url$/i,
    label: "Wallpaper upload URL",
    description: "URL to upload or fetch custom wallpapers for the phone screen. Optional.",
    options: "HTTP/HTTPS URL; empty = no custom wallpaper URL",
    category: "Provisioning",
    source: BREKEKE_COMMON,
  },
  {
    key: /^sip_server[12]$/i,
    label: "SIP server (common)",
    description: "Shared SIP server address for accounts. Account parameters (e.g. SIP_SERVER.1.ADDRESS) can reference this (SIP_SERVER1, SIP_SERVER2).",
    options: "IPv4, IPv6, or hostname; used by account.N.sip_server.N.address",
    category: "SIP",
    source: BREKEKE_COMMON,
  },
  {
    key: /^sip_server[12]_port$/i,
    label: "SIP server port (common)",
    description: "Shared SIP server port. Referenced by account parameters (e.g. SIP_SERVER1_PORT, SIP_SERVER2_PORT).",
    options: "1–65535; typical 5060 (UDP/TCP), 5061 (TLS)",
    category: "SIP",
    source: BREKEKE_COMMON,
  },
  {
    key: /^sip\.listen_port$/i,
    label: "SIP listen port",
    description: "Local UDP/TCP port the phone listens on for incoming SIP (REGISTER responses, INVITE, etc.). The phone binds to this port; it must be free and match what the server or firewall expects.",
    options: "1–65535; typical 5060; default 5060",
    category: "SIP",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^sip\.trust_ctrl$/i,
    label: "SIP trust control",
    description: "Controls which sources the phone trusts for SIP requests. Security feature to prevent unauthorized control.",
    options: "0 = Trust all; 1 = Trust server only; 2 = Trust server and proxy",
    category: "SIP",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^sip\.mac_in_ua$/i,
    label: "MAC in User-Agent",
    description: "Whether to include MAC address in the SIP User-Agent header.",
    options: "0 = Disabled; 1 = Enabled (last 6 chars); 2 = Enabled (full MAC)",
    category: "SIP",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^sip\.(timer|session_timer|registration_timer)$/i,
    label: "SIP timer",
    description: "How often (in seconds) the phone re-registers or refreshes the SIP session. Keeps the binding alive on the server.",
    options: "Positive integer (seconds); e.g. 3600 = 1 hour; typical 1800–7200",
    category: "SIP",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^mac-contact\.file$/i,
    label: "Contact file URL",
    description: "URL the phone uses to download the remote phonebook/contacts (XML). The phone fetches this and shows it in Contacts. Often same path as .cfg with -contact.xml.",
    options: "HTTP/HTTPS URL to XML phonebook; empty = no remote contacts",
    category: "Provisioning",
    source: YEALINK_REMOTE_PHONEBOOK,
  },
  {
    key: /^mac_contact\.file$/i,
    label: "Contact file URL",
    description: "Same as mac-contact.file; alternate name (underscore). URL to remote phonebook XML.",
    options: "HTTP/HTTPS URL to XML phonebook; empty = no remote contacts",
    category: "Provisioning",
    source: YEALINK_REMOTE_PHONEBOOK,
  },
  // — SIP / codec —
  // — Phone / remote phonebook —
  {
    key: /^phone_setting\.remote_phonebook\.\d+\.url$/i,
    label: "Remote phonebook URL",
    description: "URL the phone uses to fetch this remote phonebook (XML). The phone downloads and shows it in Contacts. Index 1–5 for up to 5 phonebooks.",
    options: "HTTP/HTTPS URL to XML phonebook; empty = not used",
    category: "Phone",
    source: YEALINK_REMOTE_PHONEBOOK,
  },
  {
    key: /^phone_setting\.remote_phonebook\.\d+\.display_name$/i,
    label: "Remote phonebook display name",
    description: "Name shown in the Contacts list for this remote phonebook (e.g. \"Company directory\").",
    options: "Any string; empty = default name",
    category: "Phone",
    source: YEALINK_REMOTE_PHONEBOOK,
  },
  {
    key: /^phone_setting\.backgrounds$/i,
    label: "Phone backgrounds",
    description: "Background or wallpaper image for the phone idle screen. Can be a URL to an image or a built-in resource name.",
    options: "HTTP/HTTPS URL to image, or resource name; empty = default wallpaper",
    category: "Phone",
    source: BREKEKE_COMMON,
  },
  {
    key: /^phone_setting\.key_tone$/i,
    label: "Key tone",
    description: "Whether the phone plays a beep when you press a key (dial pad, line keys).",
    options: "0 = Disabled (no beep), 1 = Enabled (beep on keypress)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.mute_ring$/i,
    label: "Mute ringer",
    description: "Whether the ringer can be muted from the phone (e.g. mute button or volume).",
    options: "0 = Disabled, 1 = Enabled (user can mute ringer)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.switch_screen$/i,
    label: "Switch screen",
    description: "Which screen is shown when answering or switching calls. 0 = stay on current screen; 1 = switch to incoming call screen.",
    options: "0 = Stay on current screen, 1 = Switch to incoming call screen",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.(restrict_edit|config_lock)$/i,
    label: "Restrict edit / config lock",
    description: "Locks phone settings so users cannot change them from the UI. Used to prevent tampering after provisioning.",
    options: "0 = Unlocked (settings editable), 1 = Locked (settings read-only)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^local_time\.time_zone$/i,
    label: "Time zone",
    description: "Time zone offset for the phone clock and call logs (e.g. +8 for UTC+8, -5 for UTC-5).",
    options: "Offset string (e.g. +8, -5, +01:00); empty = use NTP or default",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.time_zone_name$/i,
    label: "Time zone name",
    description: "Human-readable time zone name used for display and DST rules (e.g. America/New_York).",
    options: "Any string (e.g. China, America/New_York); empty = use offset only",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.ntp_server[12]$/i,
    label: "NTP server",
    description: "Primary (.1) or secondary (.2) NTP server for time sync. The phone syncs its clock from this server.",
    options: "IPv4, hostname, or NTP pool (e.g. pool.ntp.org); empty = no NTP",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.interval$/i,
    label: "NTP sync interval",
    description: "How often (in seconds) the phone syncs time from the NTP server.",
    options: "Positive integer in seconds (e.g. 3600 = hourly); Brekeke default 1000",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.summer_time$/i,
    label: "Daylight saving",
    description: "Whether the phone applies daylight saving (summer time): off, on, or automatic.",
    options: "0 = Disabled (no DST), 1 = Enabled (use DST rule), 2 = Automatic",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.dst_time_type$/i,
    label: "DST rule type",
    description: "Type of daylight saving time rule. Used with start_time and end_time when summer_time is 1 or 2. 0 = use the recurring start_time/end_time values.",
    options: "0 = Recurring (use start_time and end_time for DST window)",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.start_time$/i,
    label: "DST start time",
    description: "When daylight saving starts. Format: month/day/weekday (e.g. 3/1/0 = first Sunday of March, 1/1/0 = Jan 1). Used with dst_time_type 0.",
    options: "month/day/weekday (e.g. 1/1/0, 3/1/0); Brekeke default 1/1/0",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.end_time$/i,
    label: "DST end time",
    description: "When daylight saving ends. Format: month/day/weekday (e.g. 12/31/23 = Dec 31). Must pair with start_time; Brekeke default 12/31/23.",
    options: "month/day/weekday (e.g. 12/31/23); Brekeke default 12/31/23",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.time_format$/i,
    label: "Time format",
    description: "Whether the phone shows time in 12-hour (AM/PM) or 24-hour format.",
    options: "0 = 12 Hour (AM/PM), 1 = 24 Hour",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.dhcp_time$/i,
    label: "DHCP time",
    description: "Use time from DHCP option when available.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.manual_time_enable$/i,
    label: "Manual time",
    description: "Allow setting time manually on the phone.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^local_time\.manual_ntp_srv_prior$/i,
    label: "NTP server priority",
    description: "Which NTP server is used first.",
    options: "0 = Primary (server 1 first), 1 = Secondary (server 2 first)",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^auto_dst\.url$/i,
    label: "Auto DST URL",
    description: "URL the phone uses to download daylight saving time rules automatically.",
    options: "HTTP/HTTPS URL to DST rule file; empty = no auto DST",
    category: "Phone",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^yealink_passphrase$/i,
    label: "Yealink passphrase",
    description: "Encryption passphrase for provisioning or config; often set to {AUTO_PROVISION.AES_KEY_16.MAC}.",
    options: "Any string; often references another tag (e.g. AES key)",
    category: "Provisioning",
    source: BREKEKE_YEALINK,
  },
  {
    key: /^phone_setting\.dialnow_delay$/i,
    label: "Dial-now delay",
    description: "Seconds to wait before the dial-now rule is applied after the user stops dialing. If the user dials a matching pattern, the phone waits this many seconds then auto-dials.",
    options: "0–14 (seconds); 0 = immediate; 1 = 1 second delay (typical)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dialplan\.prefix(\.\d+)?$/i,
    label: "Dial plan prefix",
    description: "In a prefix/replace rule, the pattern the phone matches against the dialed digits. Exact match: e.g. \"0\" matches a leading zero. Partial match: \"(.)\" = any string, \"(x)\" = any single character; captured groups are used in the matching dialplan.replace.N as $1, $2.",
    options: "Exact: literal string (e.g. \"0\", \"9\"). Partial: \"(.)\" = any string, \"(x)\" = any char, \"0(.)\" = zero then any; index N for multiple rules (e.g. dialplan.prefix.1 with dialplan.replace.1)",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^dialplan\.replace(\.\d+)?$/i,
    label: "Dial plan replace",
    description: "In a prefix/replace rule, the string that replaces the matched prefix. Use $1, $2 for captured groups from the corresponding dialplan.prefix.N. Example: prefix \"0(.)\" with replace \"0086$1\" converts 0123 to 0086123.",
    options: "Literal string or pattern with $1, $2 (from prefix captures); index N must match dialplan.prefix.N",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^dialplan\.replace\.prefix\.\d+$/i,
    label: "Dial plan replace prefix",
    description: "Pattern to match for dial plan replacement rule N. When dialed digits match this prefix, they are replaced according to dialplan.replace.replace.N.",
    options: "String pattern (e.g. \"9\", \"00\", \"1800\"); index 1–N",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^dialplan\.replace\.replace\.\d+$/i,
    label: "Dial plan replace value",
    description: "Replacement string for dial plan rule N. When dialplan.replace.prefix.N matches, the matched portion is replaced with this value.",
    options: "Replacement string (e.g. empty to strip prefix, or new prefix); index must match prefix.N",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^dialplan\.dialnow\.url$/i,
    label: "Dial plan URL",
    description: "URL the phone uses to download a dial plan XML file (e.g. DialPlan.xml). Optional; used for central dial plan management.",
    options: "HTTP/HTTPS URL to XML file; empty = use only local dialplan.* rules",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^dialplan_dialnow\.url$/i,
    label: "Dial plan URL",
    description: "Same as dialplan.dialnow.url; alternate name (underscore). URL to dial plan XML file.",
    options: "HTTP/HTTPS URL to XML file; empty = use only local rules",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^dialplan\.area_code\.code$/i,
    label: "Area code",
    description: "Area code for dial plan (e.g. to prepend when normalizing local numbers). Used with area_code.line_id, max_len, min_len.",
    options: "String (e.g. 212, 44, 09); empty = no area code",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^dialplan\.area_code\.line_id$/i,
    label: "Area code line",
    description: "Which SIP account the area code rule applies to. 0 = all accounts.",
    options: "0 = all accounts; 1–N = account index",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^dialplan\.area_code\.(max_len|min_len)$/i,
    label: "Area code length",
    description: "Minimum (min_len) or maximum (max_len) digit length for numbers that get the area code applied. Used with area_code.code; e.g. 7 = 7-digit local numbers.",
    options: "Positive integer (e.g. 7 = 7-digit local; max_len/min_len in digits)",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^voice\.device_volume\.mode$/i,
    label: "Device volume mode",
    description: "High volume mode on or off. When on, the phone uses a higher maximum volume level.",
    options: "0 = Normal, 1 = High volume",
    category: "Voice",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^voice\.(ring_vol|ring_volume)$/i,
    label: "Ringer volume",
    description: "Fixed ringer volume level. Blank or not set = user can adjust from the phone.",
    options: "0–5 (level); blank = user-adjustable",
    category: "Voice",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^voice\.sidetone$/i,
    label: "Sidetone",
    description: "Local feedback in the handset so you hear yourself speak. Reduces feeling of being \"cut off\".",
    options: "0 = Off, 1 = On",
    category: "Voice",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^voice\.handset_vol$/i,
    label: "Handset volume",
    description: "Default handset (earpiece) volume level.",
    options: "0–14 (0 = mute; range may be 0–7 on some models)",
    category: "Voice",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^voice\.headset_vol$/i,
    label: "Headset volume",
    description: "Default headset volume level.",
    options: "0–14 (0 = mute; range may be 0–7 on some models)",
    category: "Voice",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^ring\.tone$/i,
    label: "Ring tone",
    description: "Ring tone used for incoming calls.",
    options: "Tone name or filename (e.g. Ring1.wav); empty = default tone",
    category: "Voice",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^ring\.volume$/i,
    label: "Ring volume",
    description: "Fixed ringer volume level. Blank = user can adjust from the phone.",
    options: "0–5 (level); blank = user-adjustable",
    category: "Voice",
    source: YEALINK_PROV_GUIDE,
  },
  // — Line keys / linekey (programmable keys, BLF, speed dial) —
  {
    key: /^(line_key|linekey)\.\d+\.type$/i,
    label: "Line key type",
    description: "Function of this programmable key.",
    options: "0 = Line, 2 = Forward, 3 = Transfer, 4 = Hold, 15 = Speed dial, 16 = BLF, 23 = Group pickup, 24 = Paging, 25 = Record, 56 = Retrieve park, 57 = Transfer to VM",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^(line_key|linekey)\.\d+\.line$/i,
    label: "Line key line",
    description: "Which SIP account (line) this key uses. For BLF/speed dial this is the line used when pressing the key to call.",
    options: "1–N (account index); 1 = first line",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^(line_key|linekey)\.\d+\.value$/i,
    label: "Line key value",
    description: "For BLF: extension to monitor (e.g. 1001). For speed dial: number or URI to dial. For park: *31, *32, *33 (park slot).",
    options: "BLF: extension (e.g. 1001); Speed dial: phone number or SIP URI; Park: *31, *32, *33",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^(line_key|linekey)\.\d+\.label$/i,
    label: "Line key label",
    description: "Text shown on the key or next to it (e.g. person name for BLF, \"Speed 1\" for speed dial).",
    options: "Any string; empty = default",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^(line_key|linekey)\.\d+\.extension$/i,
    label: "Line key extension",
    description: "For BLF/BLF list/intercom: the pickup code used when pressing the key to pick up a ringing call. For multicast paging: the channel number (0–31).",
    options: "BLF/intercom: pickup code string (e.g. *97); Paging: 0–31 (channel); empty = use global pickup code",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^(line_key|linekey)\.\d+\.xml_phonebook$/i,
    label: "Line key XML phonebook",
    description: "For XML Group or Local Group key type: specifies which remote/local phonebook to open when the key is pressed. Index 0–48.",
    options: "0–48 (phonebook index); 0 = first phonebook",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^(line_key|linekey)\.\d+\.pickup_value$/i,
    label: "Line key pickup value",
    description: "Pickup code value for this line key. Used with BLF to specify the directed pickup code for this specific key.",
    options: "String (e.g. *97, **); empty = use account or global pickup code",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  // — Features (DND, call forward, call waiting) —
  {
    key: /^features\.dnd\.allow$/i,
    label: "DND allow",
    description: "Whether the Do Not Disturb (DND) feature is available on the phone. When enabled, the user can turn DND on to reject or silence incoming calls.",
    options: "0 = Disabled (DND not available), 1 = Enabled (DND available)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.dnd_refuse_code$/i,
    label: "DND refuse code",
    description: "SIP response code sent when rejecting a call due to DND. Affects how the caller sees the rejection (e.g. busy, not found, decline).",
    options: "404 = Not Found; 480 = Temporarily Unavailable; 486 = Busy Here; 603 = Decline",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.call_forward\.(always|busy|no_answer)\.(enable|dest)$/i,
    label: "Call forward",
    description: "Call forward for this account: always forward, busy forward, or no-answer forward. .enable turns it on; .dest is the destination number.",
    options: "enable: 0 = Off, 1 = On; dest: phone number or extension; no_answer may have .delay (rings before forward)",
    category: "Call",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.call_waiting$/i,
    label: "Call waiting",
    description: "Whether call waiting is enabled for this account. When on, a second incoming call is signalled (beep) while the first is active.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Call",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.call_forward/i,
    label: "Call forward (global)",
    description: "Global call forward; use .dest for destination number.",
    options: "0 = Off, 1 = On; .dest = phone number or extension",
    category: "Call",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.call_waiting/i,
    label: "Call waiting (global)",
    description: "Enables call waiting; second incoming call is signalled.",
    options: "0 = Off, 1 = On",
    category: "Call",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.send_paging\.enable$/i,
    label: "Send paging enable",
    description: "Enables the paging (multicast send) feature. When enabled, the phone can send multicast paging to configured groups.",
    options: "0 = Disabled, 1 = Enabled (default 1)",
    category: "Multicast",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.action_uri_limit_ip$/i,
    label: "Action URI limit IP",
    description: "Restricts Action URL/URI execution to requests from specific IP addresses. Security feature to prevent unauthorized remote control.",
    options: "IP address or range (e.g. 192.168.1.0/24); empty = allow all (not recommended)",
    category: "Features",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.send_hold_before_call_park\.enable$/i,
    label: "Send hold before call park",
    description: "When enabled, the phone sends a HOLD before parking a call. Required by some PBX systems for proper call park behavior.",
    options: "0 = Disabled (park directly), 1 = Enabled (hold then park)",
    category: "Features",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.default_account$/i,
    label: "Default account",
    description: "Which SIP account is used by default for outgoing calls when no specific line is selected.",
    options: "1–N (account index); 1 = first account",
    category: "Features",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.direct_ip_call_enable$/i,
    label: "Direct IP call enable",
    description: "Allows making calls directly to an IP address without going through a SIP server. Useful for peer-to-peer calls.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Features",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.missed_call_popup\.enable$/i,
    label: "Missed call popup enable",
    description: "Shows a popup notification on the screen when a call is missed.",
    options: "0 = Disabled (no popup), 1 = Enabled (show popup)",
    category: "Features",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.caller_name_type_on_dialing$/i,
    label: "Caller name type on dialing",
    description: "Which caller ID name format to display when dialing out.",
    options: "0 = Display name, 1 = User name, 2 = Label",
    category: "Features",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^features\.enhanced_dss_keys\.enable$/i,
    label: "Enhanced DSS keys enable",
    description: "Enables Enhanced DSS Keys (EDK) feature. EDK allows custom macro actions and prompts on programmable keys.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Features",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^features\.usb_call_recording\.enable$/i,
    label: "USB call recording enable",
    description: "Enables recording calls to a USB flash drive connected to the phone.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Features",
    source: YEALINK_PROV_GUIDE,
  },
  // — Multicast paging (Yealink multicast IP paging) —
  {
    key: /^multicast\.paging_address\.\d+\.ip_address$/i,
    label: "Multicast paging address",
    description: "Multicast IP address and port for paging group N. The phone sends paging RTP to this address when initiating a page.",
    options: "IPv4:port (e.g. 224.0.1.75:10008 or 224.0.1.116:60000); group index 1–31",
    category: "Multicast",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^multicast\.paging_address\.\d+\.label$/i,
    label: "Multicast paging label",
    description: "Label/name for this paging group (e.g. \"Warehouse\", \"All\"). Shown in the phone UI.",
    options: "Any string; empty = default",
    category: "Multicast",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^multicast\.paging_address\.\d+\.channel$/i,
    label: "Multicast paging channel",
    description: "Channel number for this paging group. Yealink supports 0–30 channels; must match your paging system.",
    options: "0–30 (channel index)",
    category: "Multicast",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^multicast\.listen_address\.\d+\.ip_address$/i,
    label: "Multicast listen address",
    description: "Multicast IP address and port the phone listens on to receive paging. Incoming pages are played on the speaker.",
    options: "IPv4:port (e.g. 224.0.1.75:10008); index 1–N",
    category: "Multicast",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^multicast\.listen_address\.\d+\.label$/i,
    label: "Multicast listen label",
    description: "Label for this multicast listen group. Shown in the phone UI.",
    options: "Any string; empty = default",
    category: "Multicast",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^multicast\.listen_address\.\d+\.channel$/i,
    label: "Multicast listen channel",
    description: "Channel number for this multicast listen group. Must match the sender's channel for paging to be received.",
    options: "0–30 (channel index)",
    category: "Multicast",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^multicast\.codec$/i,
    label: "Multicast codec",
    description: "Audio codec used for multicast paging. Both sender and receiver must use the same codec.",
    options: "PCMU; PCMA; G722; G729",
    category: "Multicast",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^multicast\.receive_priority\.enable$/i,
    label: "Multicast receive priority enable",
    description: "Enables priority-based handling of incoming multicast pages. Higher priority pages interrupt lower priority ones.",
    options: "0 = Disabled; 1 = Enabled",
    category: "Multicast",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^multicast\.receive_priority\.priority$/i,
    label: "Multicast receive priority",
    description: "Priority level for receiving multicast pages. Lower number = higher priority. Pages with higher priority interrupt current audio.",
    options: "1–10 (1 = highest priority; 10 = lowest)",
    category: "Multicast",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.inter_digit_timer$/i,
    label: "Inter-digit timer",
    description: "Seconds the phone waits after the user stops dialing before applying dial-now or sending the call. Longer = more time to dial extra digits.",
    options: "Positive integer (seconds); e.g. 3–10; 4 = 4 seconds (typical)",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^expansion_module\.\d+\.type$/i,
    label: "Expansion key type",
    description: "Function of this expansion module key.",
    options: "0 = Line, 16 = BLF, 15 = Speed dial, 2 = Forward, 3 = Transfer, 4 = Hold",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^expansion_module\.\d+\.line$/i,
    label: "Expansion key line",
    description: "SIP account (line) used when this key is pressed.",
    options: "1–N (account index)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^expansion_module\.\d+\.value$/i,
    label: "Expansion key value",
    description: "BLF extension to monitor or speed-dial number.",
    options: "BLF: extension (e.g. 1001); Speed dial: number or SIP URI",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^expansion_module\.\d+\.label$/i,
    label: "Expansion key label",
    description: "Text shown on the expansion key.",
    options: "Any string",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  // — Programmable keys —
  {
    key: /^program+ablekey\.\d+\.type$/i,
    label: "Programmable key type",
    description: "Function assigned to this programmable key (softkey or navigation key).",
    options: "0 = N/A; 2 = Forward; 5 = DND; 7 = Recall; 8 = SMS; 9 = Pickup; 13 = Speed Dial; 14 = Intercom; 22 = XML Group; 23 = Group Pickup; 24 = Paging; 27 = XML Browser; 28 = History; 30 = Menu; 33 = Status; 34 = Hot Desking; 38 = LDAP; 40 = Prefix; 45 = Local Group; 50 = Phone Lock; 51 = Switch Account Up; 52 = Switch Account Down; 61 = Directory; 66 = Paging List; 73 = Custom Key",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^program+ablekey\.\d+\.line$/i,
    label: "Programmable key line",
    description: "Which SIP account (line) this programmable key uses for its function.",
    options: "0 = All/Auto; 1–16 = Account index",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^program+ablekey\.\d+\.value$/i,
    label: "Programmable key value",
    description: "Value for this programmable key. For speed dial: number to dial. For paging: multicast address:port.",
    options: "String (phone number, SIP URI, or multicast address:port)",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^program+ablekey\.\d+\.label$/i,
    label: "Programmable key label",
    description: "Custom label displayed for this programmable key.",
    options: "Any string; empty = use default label",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^program+ablekey\.\d+\.extension$/i,
    label: "Programmable key extension",
    description: "For paging: channel number (0–31). For intercom: pickup code.",
    options: "Paging: 0–31 (channel); Intercom: pickup code string",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  // — Softkeys —
  {
    key: /^softkey\.\d+\.enable$/i,
    label: "Softkey enable",
    description: "Enables this custom softkey entry.",
    options: "0 = Disabled; 1 = Enabled",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^softkey\.\d+\.label$/i,
    label: "Softkey label",
    description: "Text displayed on this softkey button.",
    options: "Any string (short, fits softkey width)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^softkey\.\d+\.position$/i,
    label: "Softkey position",
    description: "Position of this softkey on the softkey bar (1–4 for most phones).",
    options: "1–4 (left to right); 1 = first position",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^softkey\.\d+\.action$/i,
    label: "Softkey action",
    description: "Action macro executed when this softkey is pressed. Uses EDK macro syntax.",
    options: "EDK macro string (e.g. #3$P1N4$$Tdtmf$ for transfer with DTMF)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^softkey\.\d+\.softkey_id$/i,
    label: "Softkey ID",
    description: "Unique identifier for this softkey. Used for internal reference.",
    options: "Any string (e.g. xfer_vm, park_call)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^softkey\.\d+\.use\.on_talk$/i,
    label: "Softkey use on talk",
    description: "Whether this softkey appears during active calls (talk state) or when idle.",
    options: "0 = Idle only; 1 = Talk/call only",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  // — Multiring, hot desking, expansion, other —
  {
    key: /^account\.\d+\.multiring$/i,
    label: "Multiring",
    description: "Whether this account rings on multiple line keys or only the primary. When enabled, incoming calls to this account ring on all keys configured for it.",
    options: "0 = Single line (ring only primary); 1 = Multiring (ring on all keys for this account)",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  // — Voicemail, ring, message waiting —
  {
    key: /^account\.\d+\.voicemail\.(number|enable)$/i,
    label: "Voicemail",
    description: "Voicemail number or enable for this account. .number = dial string to reach voicemail (e.g. *97 or 5001). .enable = turn voicemail access on/off.",
    options: "number: dial string (e.g. *97, 5001); enable: 0 = Off, 1 = On",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.vm_number$/i,
    label: "Voicemail number",
    description: "Dial string to reach voicemail for this account (e.g. *97 or 5001). Alternate to account.N.voicemail.number.",
    options: "Dial string (e.g. *97, 5001); empty = no voicemail number",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.(message_center|mwi)/i,
    label: "Message waiting",
    description: "Enables MWI: phone subscribes and shows voicemail indicator when server has messages.",
    options: "0 = Off, 1 = On",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  // — Additional specific parameters (Yealink/Brekeke, admin guide) —
  {
    key: /^network\.(ip_address|eth\.\d+\.ip_address)$/i,
    label: "IP address",
    description: "Static IPv4 address for the phone LAN or Ethernet port. Used when not using DHCP; use with subnet_mask and gateway.",
    options: "IPv4 address (e.g. 192.168.1.100); empty or 0.0.0.0 = use DHCP",
    category: "Network",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.conf_(type|uri)$/i,
    label: "Conference type / URI",
    description: "Conference setting for this account. conf_type: 0 = local conference, 1 = network conference. conf_uri: SIP URI for network conference (RFC 4579 REFER); max 511 chars.",
    options: "conf_type: 0 = Local, 1 = Network; conf_uri: SIP URI when network conference",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.answer_mode$/i,
    label: "Answer mode",
    description: "How the phone answers: manual or auto. When auto, the phone answers incoming calls automatically.",
    options: "0 = Manual answer, 1 = Auto answer",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.early_media$/i,
    label: "Early media",
    description: "Whether to allow early media (183 Session Progress, ringback) before the call is answered.",
    options: "0 = Off (ignore 183), 1 = On (allow early media)",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^account\.\d+\.call_forward\.(always|busy|no_answer)\.(delay|time)$/i,
    label: "Call forward delay",
    description: "For no-answer call forward: seconds or rings before forwarding. For always/busy forward this may be unused.",
    options: "Positive integer (seconds or ring count); e.g. 20–30 for no_answer",
    category: "Call",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dialplan\.dialnow\.delay$/i,
    label: "Dial-now delay",
    description: "Seconds to wait after the user stops dialing before the phone auto-dials (when the dialed digits match a dialnow rule).",
    options: "0–14 (seconds); 0 = immediate; 1 = 1 second (typical)",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^dialplan\.dialnow\.rule$/i,
    label: "Dial-now rule",
    description: "Pattern that triggers auto-dial (e.g. [2-9]xxxxxx for 7-digit local). When the user dials a matching pattern and the delay elapses, the phone sends the call.",
    options: "Regex-style: x = digit, [2-9], etc.; e.g. [2-9]xxxxxx",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^dialplan\.dialnow\.line_id$/i,
    label: "Dial-now line",
    description: "Which SIP account to use when the dial-now rule triggers. 0 = use default or all.",
    options: "0 = all/default; 1–N = account index",
    category: "Phone",
    source: YEALINK_DIAL_PLAN,
  },
  {
    key: /^blf\.\d+\./i,
    label: "BLF (Busy Lamp Field)",
    description: "BLF list entry: extension to monitor and optional label. The phone subscribes to presence (dialog/SUBSCRIBE) and shows busy/idle on the line key. blf.N.extension = extension; blf.N.label = text on key.",
    options: ".extension = extension to monitor (e.g. 1001); .label = string shown on key; index 1–N",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^phone_setting\.language$/i,
    label: "Language",
    description: "UI language for menus and display.",
    options: "en, en-US, zh, zh-TW, de, fr, es, it, pt, nl, pl, ru, ja, ko (and other Yealink locale codes)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^directory_setting\.local_directory\.enable$/i,
    label: "Local directory enable",
    description: "Enables or disables access to the local phonebook/directory on the phone.",
    options: "0 = Disabled (local directory hidden), 1 = Enabled (local directory accessible)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  // — Device Management (dm.*) —
  {
    key: /^dm\.enable$/i,
    label: "Device management enable",
    description: "Enables Yealink Device Management Platform (YDMP) integration. When enabled, the phone connects to the DM server for centralized management.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Device Management",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dm\.server\.port$/i,
    label: "DM server port",
    description: "Port number for connecting to the Device Management server.",
    options: "1–65535; typical 443 (HTTPS) or 80 (HTTP)",
    category: "Device Management",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dm\.server\.http_enable$/i,
    label: "DM HTTP enable",
    description: "Enables HTTP (non-encrypted) connection to the Device Management server.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Device Management",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dm\.server\.https_enable$/i,
    label: "DM HTTPS enable",
    description: "Enables HTTPS (encrypted) connection to the Device Management server.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Device Management",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dm\.server\.retry_min_interval$/i,
    label: "DM retry min interval",
    description: "Minimum interval in seconds between retry attempts when DM server connection fails.",
    options: "Positive integer (seconds); e.g. 30",
    category: "Device Management",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dm\.server\.retry_interval_multiplier$/i,
    label: "DM retry multiplier",
    description: "Multiplier for exponential backoff when retrying DM server connection. Each retry waits longer.",
    options: "Decimal multiplier (e.g. 2.0 = double wait each retry)",
    category: "Device Management",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dm\.server\.retry_interval_max_power$/i,
    label: "DM retry max power",
    description: "Maximum exponent for the retry interval calculation. Limits how long the phone waits between retries.",
    options: "Positive integer (e.g. 10 = max 2^10 multiplier)",
    category: "Device Management",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dm\.server\.address$/i,
    label: "DM server address",
    description: "Hostname or IP address of the Yealink Device Management server.",
    options: "Hostname or IPv4 address (e.g. dm.yealink.com or 192.168.1.100)",
    category: "Device Management",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dm\.qoe_report\.enable$/i,
    label: "QoE report enable",
    description: "Enables Quality of Experience (QoE) reporting to the Device Management server. Reports call quality metrics.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Device Management",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^dm\.qoe_report\.periodic\.enable$/i,
    label: "QoE periodic report enable",
    description: "Enables periodic QoE reports (at intervals) in addition to per-call reports.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Device Management",
    source: YEALINK_PROV_GUIDE,
  },
  // — Enhanced DSS Keys (EDK) —
  {
    key: /^edk\.edkprompt\.\d+\.enable$/i,
    label: "EDK prompt enable",
    description: "Enables this Enhanced DSS Key prompt entry. EDK allows custom macro actions on DSS keys.",
    options: "0 = Disabled, 1 = Enabled",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^edk\.edkprompt\.\d+\.label$/i,
    label: "EDK prompt label",
    description: "Label/title displayed for this EDK prompt when the user interacts with the custom key.",
    options: "Any string (e.g. \"Enter PIN\", \"Room Number\")",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^edk\.edkprompt\.\d+\.type$/i,
    label: "EDK prompt type",
    description: "Type of EDK prompt: text input, numeric input, or selection.",
    options: "0 = Text, 1 = Numeric, 2 = Selection",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^edk\.edkprompt\.\d+\.userfeedback$/i,
    label: "EDK prompt user feedback",
    description: "Whether to show/mask user input for this EDK prompt (e.g. for PIN entry).",
    options: "0 = Show input, 1 = Mask input (like password)",
    category: "Phone",
    source: YEALINK_LINE_KEYS,
  },
  {
    key: /^phone_setting\.ring_tone$/i,
    label: "Default ring tone",
    description: "Default ring tone name or file for incoming calls.",
    options: "Tone name or file; empty = default",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.date_format$/i,
    label: "Date format",
    description: "How the date is displayed on the phone (e.g. MM/DD/YYYY vs DD/MM/YYYY).",
    options: "0 = MM/DD/YYYY; 1 = DD/MM/YYYY; 2 = YYYY/MM/DD",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.redial_number$/i,
    label: "Redial number",
    description: "The number dialed when pressing the redial key. Can be a specific number or the last dialed number.",
    options: "Phone number or SIP URI; empty = last dialed number",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.redial_server$/i,
    label: "Redial server",
    description: "SIP server used for the redial function when a specific redial_number is configured.",
    options: "Hostname or IP address of SIP server",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.call_return_user_name$/i,
    label: "Call return user name",
    description: "Username for the call return (callback) feature. Used with call_return_server.",
    options: "String (SIP username)",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.call_return_server$/i,
    label: "Call return server",
    description: "SIP server used for the call return (callback) feature.",
    options: "Hostname or IP address of SIP server",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.called_party_info_display\.enable$/i,
    label: "Called party info display",
    description: "Whether to display called party information during outgoing calls.",
    options: "0 = Disabled; 1 = Enabled",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^phone_setting\.call_info_display_method$/i,
    label: "Call info display method",
    description: "How call information is displayed on screen during calls.",
    options: "0 = Name; 1 = Number; 2 = Name and Number; 3 = Number and Name",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^sip\.proxy$/i,
    label: "SIP proxy",
    description: "Global SIP proxy host and port. When set, can override or complement per-account routing.",
    options: "host:port (e.g. proxy.example.com:5060)",
    category: "SIP",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^sip\.outbound_proxy$/i,
    label: "SIP outbound proxy",
    description: "Global outbound proxy host and port for SIP traffic.",
    options: "host:port (e.g. sbc.example.com:5060)",
    category: "SIP",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^sip\.register_expires$/i,
    label: "REGISTER Expires",
    description: "Value (in seconds) sent in the SIP REGISTER Expires header. How long the registration binding is valid.",
    options: "Positive integer (seconds); e.g. 3600",
    category: "SIP",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^call\.forward$/i,
    label: "Call forward (global)",
    description: "Global call forward on/off. Use .dest for destination number. Per-account: account.N.call_forward.*.",
    options: "0 = Off, 1 = On; .dest = destination number",
    category: "Call",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^call\.waiting$/i,
    label: "Call waiting (global)",
    description: "Global call waiting on/off. When on, a second incoming call is signalled. Per-account: account.N.call_waiting.",
    options: "0 = Off, 1 = On",
    category: "Call",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^call\.(transfer|hold|park)$/i,
    label: "Call transfer / hold / park (global)",
    description: "Global call transfer, hold, or park feature on/off.",
    options: "0 = Off, 1 = On",
    category: "Call",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^sip_server[12](_port)?$/i,
    label: "SIP server (common)",
    description: "Shared SIP server address (SIP_SERVER1, SIP_SERVER2) or port (SIP_SERVER1_PORT, SIP_SERVER2_PORT). Referenced by account.N.sip_server.N.address and .port in local config.",
    options: "Address: IPv4, IPv6, or hostname; port: 1–65535 (e.g. 5060 UDP/TCP, 5061 TLS)",
    category: "SIP",
    source: BREKEKE_COMMON,
  },
  // — Push XML —
  {
    key: /^push_xml\.sip_notify$/i,
    label: "Push XML SIP NOTIFY",
    description: "Enables receiving XML push content via SIP NOTIFY messages. Used for remote control and status updates.",
    options: "0 = Disabled; 1 = Enabled",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
  // — Static settings (persist across factory reset) —
  {
    key: /^static\.security\.user_password$/i,
    label: "User password",
    description: "Web UI login credentials in format user:password. Static prefix ensures it survives factory reset.",
    options: "user:password (e.g. admin:mypassword or user:mypassword)",
    category: "Security",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^static\.wui\.http_enable$/i,
    label: "Web UI HTTP enable",
    description: "Enables HTTP access to the phone web interface. Static prefix ensures setting survives factory reset.",
    options: "0 = Disabled; 1 = Enabled",
    category: "Security",
    source: YEALINK_PROV_GUIDE,
  },
  {
    key: /^static\.wui\.https_enable$/i,
    label: "Web UI HTTPS enable",
    description: "Enables HTTPS access to the phone web interface. Static prefix ensures setting survives factory reset.",
    options: "0 = Disabled; 1 = Enabled",
    category: "Security",
    source: YEALINK_PROV_GUIDE,
  },
  // — Transfer settings —
  {
    key: /^transfer\.dsskey_deal_type$/i,
    label: "Transfer DSS key behavior",
    description: "How DSS keys behave during call transfer. Controls whether pressing a BLF/speed dial key performs blind or attended transfer.",
    options: "0 = Blind transfer; 1 = Attended transfer; 2 = New call",
    category: "Call",
    source: YEALINK_PROV_GUIDE,
  },
  // — Voicemail —
  {
    key: /^voice_mail\.number\.\d+$/i,
    label: "Voicemail number",
    description: "Voicemail access number for this account. Dialed when pressing the voicemail key.",
    options: "Dial string (e.g. *95, *97, 5001)",
    category: "Account",
    source: YEALINK_PROV_GUIDE,
  },
  // — Voice / RTP settings —
  {
    key: /^voice\.rtcp_xr\.enable$/i,
    label: "RTCP-XR enable",
    description: "Enables RTCP Extended Reports (RTCP-XR) for voice quality monitoring and reporting.",
    options: "0 = Disabled; 1 = Enabled",
    category: "Voice",
    source: YEALINK_PROV_GUIDE,
  },
  // — Local contacts —
  {
    key: /^local_contact\.favorite\.enable$/i,
    label: "Local contact favorites",
    description: "Enables the favorites feature in the local phonebook.",
    options: "0 = Disabled; 1 = Enabled",
    category: "Phone",
    source: YEALINK_PROV_GUIDE,
  },
];

/**
 * Get label, description, options, and source for a provision key.
 */
export function getFieldInfo(key: string): FieldInfo | null {
  const k = key.trim();
  if (!k) return null;

  const exact = YEALINK_FIELD_REFERENCE.find((e) => typeof e.key === "string" && e.key === k);
  if (exact) return { label: exact.label, description: exact.description, category: exact.category, options: exact.options, source: exact.source };

  const regexMatch = YEALINK_FIELD_REFERENCE.find((e) => e.key instanceof RegExp && (e.key as RegExp).test(k));
  if (regexMatch) return { label: regexMatch.label, description: regexMatch.description, category: regexMatch.category, options: regexMatch.options, source: regexMatch.source };

  const prefixMatch = YEALINK_FIELD_REFERENCE.filter((e) => typeof e.key === "string" && (e.key as string).length > 1 && k.startsWith(e.key as string))
    .sort((a, b) => (b.key as string).length - (a.key as string).length)[0];
  if (prefixMatch) return { label: prefixMatch.label, description: prefixMatch.description, category: prefixMatch.category, options: prefixMatch.options, source: prefixMatch.source };

  return null;
}

/** Message shown when a parameter has no entry in the reference. No generic text — we explicitly say the setting is unknown. */
const UNKNOWN_DESCRIPTION = "This setting is not in the reference. It may be model-specific or not yet documented here.";

/**
 * Like getFieldInfo but always returns a FieldInfo. Unknown keys get an explicit "unknown" response — no generic description.
 */
export function getFieldInfoWithFallback(key: string): FieldInfo {
  const k = key.trim();
  const known = getFieldInfo(k);
  if (known) return known;
  return {
    label: "Unknown parameter",
    description: UNKNOWN_DESCRIPTION,
    category: "Other",
  };
}

export function getAllFieldReferenceEntries(): FieldReferenceEntry[] {
  return YEALINK_FIELD_REFERENCE;
}

/** Get all unique categories from the field reference, sorted alphabetically. */
export function getAllCategories(): string[] {
  const cats = new Set<string>();
  for (const e of YEALINK_FIELD_REFERENCE) {
    if (e.category) cats.add(e.category);
  }
  return Array.from(cats).sort();
}

/** Convert a FieldReferenceEntry key to a displayable string (regex → readable pattern). */
export function keyToInsertString(entry: FieldReferenceEntry, index?: number): string {
  if (typeof entry.key === "string") return entry.key;
  // Convert regex source to a usable key string, e.g. ^account\.\d+\.enable$ → account.1.enable
  let s = (entry.key as RegExp).source;
  // Strip anchors
  s = s.replace(/^\^/, "").replace(/\$$/, "");
  // Strip case-insensitive group wrappers
  s = s.replace(/\(\?:([^)]+)\)/g, "$1");
  // Replace escaped dots
  s = s.replace(/\\\./g, ".");
  // Replace digit matchers with the index or placeholder
  const idx = index != null ? String(index) : "1";
  s = s.replace(/\\d\+/g, idx).replace(/\[0-9\]\+/g, idx).replace(/\\d/g, idx);
  // Remove remaining regex artifacts
  s = s.replace(/[()[\]?|\\]/g, "");
  // Clean optional prefixes like "static." that may be grouped
  s = s.replace(/^static\.?/i, "");
  return s;
}

/** Ensures every reference entry has label, description, options, category, and source so tooltips can be fully filled. */
export function validateFieldReference(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  YEALINK_FIELD_REFERENCE.forEach((e, i) => {
    const keyStr = typeof e.key === "string" ? e.key : (e.key as RegExp).source;
    if (!e.label?.trim()) missing.push(`[${i}] ${keyStr}: missing label`);
    if (!e.description?.trim()) missing.push(`[${i}] ${keyStr}: missing description`);
    if (e.options === undefined || e.options === "") missing.push(`[${i}] ${keyStr}: missing options`);
    if (!e.category?.trim()) missing.push(`[${i}] ${keyStr}: missing category`);
    if (!e.source?.name) missing.push(`[${i}] ${keyStr}: missing source`);
  });
  return { ok: missing.length === 0, missing };
}
