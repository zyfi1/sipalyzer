export interface LogPreset {
  id: string;
  label: string;
  path: string;
  category: string;
  description: string;
}

export const LOG_PRESETS: LogPreset[] = [
  // PBX Systems
  { id: "asterisk-full", label: "Asterisk Full", path: "/var/log/asterisk/full", category: "PBX", description: "Asterisk full debug log" },
  { id: "asterisk-messages", label: "Asterisk Messages", path: "/var/log/asterisk/messages", category: "PBX", description: "Asterisk messages log" },
  { id: "freepbx", label: "FreePBX", path: "/var/log/asterisk/freepbx.log", category: "PBX", description: "FreePBX application log" },
  { id: "freeswitch", label: "FreeSWITCH", path: "/var/log/freeswitch/freeswitch.log", category: "PBX", description: "FreeSWITCH main log" },
  { id: "kamailio", label: "Kamailio", path: "/var/log/kamailio/kamailio.log", category: "PBX", description: "Kamailio SIP proxy log" },

  // System
  { id: "syslog", label: "Syslog", path: "/var/log/syslog", category: "System", description: "System syslog" },
  { id: "messages", label: "Messages", path: "/var/log/messages", category: "System", description: "System messages" },
  { id: "auth", label: "Auth Log", path: "/var/log/auth.log", category: "System", description: "Authentication log" },
  { id: "kern", label: "Kernel", path: "/var/log/kern.log", category: "System", description: "Kernel messages" },
  { id: "dmesg", label: "Dmesg", path: "/var/log/dmesg", category: "System", description: "Boot and kernel ring buffer" },

  // Network
  { id: "dhcpd", label: "DHCP Server", path: "/var/log/dhcpd.log", category: "Network", description: "DHCP server lease log" },
  { id: "named", label: "DNS (BIND)", path: "/var/log/named/named.log", category: "Network", description: "BIND DNS server log" },
  { id: "snmpd", label: "SNMP Daemon", path: "/var/log/snmpd.log", category: "Network", description: "SNMP daemon log" },

  // Web / App
  { id: "nginx-access", label: "Nginx Access", path: "/var/log/nginx/access.log", category: "Web", description: "Nginx HTTP access log" },
  { id: "nginx-error", label: "Nginx Error", path: "/var/log/nginx/error.log", category: "Web", description: "Nginx error log" },
  { id: "apache-access", label: "Apache Access", path: "/var/log/apache2/access.log", category: "Web", description: "Apache HTTP access log" },
  { id: "apache-error", label: "Apache Error", path: "/var/log/apache2/error.log", category: "Web", description: "Apache error log" },
];

export const LOG_CATEGORIES = [...new Set(LOG_PRESETS.map((p) => p.category))];
