/**
 * Indexed Parameter Groups — definitions + detection for Yealink provisioning
 *
 * Many Yealink parameters follow an indexed pattern like:
 *   multicast.paging_address.1.ip_address
 *   multicast.paging_address.2.ip_address
 *
 * This module defines the known groups, detects them from a key string,
 * scans editor text for all instances, and builds formatted lines.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface GroupField {
  /** Sub-field suffix after the index, e.g. "ip_address", "label", "type" */
  suffix: string;
  /** Human-readable label */
  label: string;
  /** Placeholder hint */
  placeholder?: string;
}

export interface IndexedParamGroup {
  /** Unique ID, e.g. "multicast_paging" */
  id: string;
  /** Display label, e.g. "Multicast Paging Addresses" */
  label: string;
  /** Base prefix before the index, e.g. "multicast.paging_address" */
  basePrefix: string;
  /** Sub-fields within each index */
  fields: GroupField[];
  /** Maximum index (informational) */
  maxIndex?: number;
  /**
   * If true, the key is `basePrefix.INDEX` with no suffix (e.g. voice_mail.number.1).
   * In this case `fields` should have exactly one entry with suffix = "".
   */
  singleValue?: boolean;
}

// ── Group Definitions ───────────────────────────────────────────────────────

export const INDEXED_PARAM_GROUPS: IndexedParamGroup[] = [
  {
    id: "account",
    label: "SIP Accounts",
    basePrefix: "account",
    maxIndex: 16,
    fields: [
      { suffix: "enable", label: "Enable", placeholder: "0 or 1" },
      { suffix: "label", label: "Label", placeholder: "Line label" },
      { suffix: "display_name", label: "Display Name", placeholder: "Caller ID name" },
      { suffix: "user_name", label: "Username", placeholder: "SIP username" },
      { suffix: "auth_name", label: "Auth Name", placeholder: "SIP auth name" },
      { suffix: "password", label: "Password", placeholder: "SIP password" },
      { suffix: "sip_server_host", label: "SIP Server", placeholder: "sip.example.com" },
      { suffix: "sip_server_port", label: "SIP Port", placeholder: "5060" },
      { suffix: "transport", label: "Transport", placeholder: "0=UDP, 1=TCP, 2=TLS" },
      { suffix: "register", label: "Register", placeholder: "0=disable, 1=enable" },
    ],
  },
  {
    id: "linekey",
    label: "Line Keys",
    basePrefix: "linekey",
    maxIndex: 60,
    fields: [
      { suffix: "type", label: "Type", placeholder: "0=N/A, 1=Conf, 2=Fwd, 13=Speed Dial, 15=Line, 16=BLF..." },
      { suffix: "line", label: "Line", placeholder: "Account index (0 = auto)" },
      { suffix: "value", label: "Value", placeholder: "Extension / number / URI" },
      { suffix: "label", label: "Label", placeholder: "Key label text" },
      { suffix: "extension", label: "Extension", placeholder: "Extension value" },
      { suffix: "xml_phonebook", label: "XML Phonebook", placeholder: "Phonebook URL" },
      { suffix: "pickup_value", label: "Pickup Value", placeholder: "Pickup code" },
    ],
  },
  {
    id: "multicast_paging",
    label: "Multicast Paging Addresses",
    basePrefix: "multicast.paging_address",
    maxIndex: 31,
    fields: [
      { suffix: "ip_address", label: "IP Address", placeholder: "224.0.1.75:5001" },
      { suffix: "label", label: "Label", placeholder: "Paging group name" },
      { suffix: "channel", label: "Channel", placeholder: "0-30" },
    ],
  },
  {
    id: "multicast_listen",
    label: "Multicast Listen Addresses",
    basePrefix: "multicast.listen_address",
    maxIndex: 31,
    fields: [
      { suffix: "ip_address", label: "IP Address", placeholder: "224.0.1.75:5001" },
      { suffix: "label", label: "Label", placeholder: "Listen group name" },
      { suffix: "channel", label: "Channel", placeholder: "0-30" },
    ],
  },
  {
    id: "programablekey",
    label: "Programmable Keys",
    basePrefix: "programablekey",
    maxIndex: 14,
    fields: [
      { suffix: "type", label: "Type", placeholder: "0=N/A, 2=Fwd, 5=DND, 24=Multicast..." },
      { suffix: "line", label: "Line", placeholder: "Account index (0 = auto)" },
      { suffix: "value", label: "Value", placeholder: "Extension / number / URI" },
      { suffix: "label", label: "Label", placeholder: "Key label text" },
      { suffix: "extension", label: "Extension", placeholder: "Extension value" },
    ],
  },
  {
    id: "softkey",
    label: "Soft Keys",
    basePrefix: "softkey",
    maxIndex: 12,
    fields: [
      { suffix: "enable", label: "Enable", placeholder: "0 or 1" },
      { suffix: "label", label: "Label", placeholder: "Softkey label" },
      { suffix: "position", label: "Position", placeholder: "1-6" },
      { suffix: "action", label: "Action", placeholder: "EDK macro or action string" },
      { suffix: "softkey_id", label: "Softkey ID", placeholder: "Unique ID string" },
      { suffix: "use.on_talk", label: "Use On Talk", placeholder: "0 or 1" },
    ],
  },
  {
    id: "edk_prompt",
    label: "EDK Prompts",
    basePrefix: "edk.edkprompt",
    maxIndex: 10,
    fields: [
      { suffix: "enable", label: "Enable", placeholder: "0 or 1" },
      { suffix: "label", label: "Label", placeholder: "Prompt label" },
      { suffix: "type", label: "Type", placeholder: "0=standard, 1=password" },
      { suffix: "userfeedback", label: "User Feedback", placeholder: "0=none, 1=echo, 2=mask" },
    ],
  },
  {
    id: "expansion_module",
    label: "Expansion Module Keys",
    basePrefix: "expansion_module",
    maxIndex: 60,
    fields: [
      { suffix: "type", label: "Type", placeholder: "Key type (same as linekey)" },
      { suffix: "line", label: "Line", placeholder: "Account index" },
      { suffix: "value", label: "Value", placeholder: "Extension / number / URI" },
      { suffix: "label", label: "Label", placeholder: "Key label text" },
    ],
  },
  {
    id: "voice_mail",
    label: "Voicemail Numbers",
    basePrefix: "voice_mail.number",
    maxIndex: 16,
    singleValue: true,
    fields: [
      { suffix: "", label: "Number", placeholder: "*95 or voicemail number" },
    ],
  },
  {
    id: "remote_phonebook",
    label: "Remote Phonebooks",
    basePrefix: "phone_setting.remote_phonebook",
    maxIndex: 5,
    fields: [
      { suffix: "url", label: "URL", placeholder: "https://example.com/contacts.xml" },
      { suffix: "display_name", label: "Display Name", placeholder: "Phonebook name" },
    ],
  },
  {
    id: "dialplan_replace",
    label: "Dial Plan Replace Rules",
    basePrefix: "dialplan.replace",
    maxIndex: 100,
    fields: [
      { suffix: "prefix", label: "Prefix", placeholder: "Pattern to match" },
      { suffix: "replace", label: "Replace", placeholder: "Replacement string" },
    ],
  },
  {
    id: "blf",
    label: "BLF Entries",
    basePrefix: "blf",
    maxIndex: 50,
    fields: [
      { suffix: "extension", label: "Extension", placeholder: "Monitored extension" },
      { suffix: "label", label: "Label", placeholder: "Display label" },
    ],
  },
];

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Given a full parameter key (e.g. "multicast.paging_address.2.ip_address"),
 * detect which group it belongs to and extract the numeric index.
 * Returns null if the key doesn't match any known indexed group.
 */
export function detectGroup(
  key: string
): { group: IndexedParamGroup; index: number } | null {
  if (!key) return null;
  const k = key.toLowerCase().trim();

  for (const group of INDEXED_PARAM_GROUPS) {
    const prefix = group.basePrefix.toLowerCase();

    // Pattern: basePrefix.INDEX.suffix  or  basePrefix.INDEX  (singleValue)
    // e.g. "multicast.paging_address.2.ip_address" or "voice_mail.number.3"
    if (!k.startsWith(prefix + ".")) continue;

    const afterPrefix = k.slice(prefix.length + 1); // "2.ip_address" or "3"
    const dotIdx = afterPrefix.indexOf(".");

    let indexStr: string;
    let suffix: string;

    if (dotIdx === -1) {
      // No dot after prefix.INDEX → could be singleValue or just the index
      indexStr = afterPrefix;
      suffix = "";
    } else {
      indexStr = afterPrefix.slice(0, dotIdx);
      suffix = afterPrefix.slice(dotIdx + 1);
    }

    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0) continue;

    // Verify the suffix matches one of the group's fields
    if (group.singleValue && suffix === "") {
      return { group, index };
    }

    const matchesField = group.fields.some(
      (f) => f.suffix.toLowerCase() === suffix
    );
    if (matchesField) {
      return { group, index };
    }

    // Even if suffix doesn't match a known field, still detect the group
    // (could be a sub-field we haven't defined, like account.1.sip_server.1.address)
    // Only match if the index part was numeric
    if (suffix && !suffix.includes(".")) {
      // Likely a sub-field we don't have in our definition — still return group
      return { group, index };
    }
  }

  return null;
}

// ── Editor Scanning ─────────────────────────────────────────────────────────

/**
 * Scan editor text for all lines belonging to a group.
 * Returns a map of index → { suffix → value }.
 *
 * For single-value groups (voice_mail.number.X), suffix is "".
 */
export function scanEditorForGroup(
  text: string,
  group: IndexedParamGroup
): Map<number, Record<string, string>> {
  const result = new Map<number, Record<string, string>>();
  const prefix = group.basePrefix.toLowerCase();
  const lines = text.split("\n");

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;

    const eqIdx = t.indexOf("=");
    if (eqIdx <= 0) continue;

    const key = t.slice(0, eqIdx).trimEnd().toLowerCase();
    const value = t.slice(eqIdx + 1).trimStart();

    if (!key.startsWith(prefix + ".")) continue;

    const afterPrefix = key.slice(prefix.length + 1);
    const dotIdx = afterPrefix.indexOf(".");

    let indexStr: string;
    let suffix: string;

    if (dotIdx === -1) {
      indexStr = afterPrefix;
      suffix = "";
    } else {
      indexStr = afterPrefix.slice(0, dotIdx);
      suffix = afterPrefix.slice(dotIdx + 1);
    }

    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0) continue;

    if (!result.has(index)) {
      result.set(index, {});
    }
    result.get(index)![suffix] = value;
  }

  return result;
}

// ── Line Building ───────────────────────────────────────────────────────────

/**
 * Build a formatted config line for a specific field in a group instance.
 * E.g. buildLineForField(multicastPaging, 2, "ip_address", "224.0.1.76")
 * → "multicast.paging_address.2.ip_address = 224.0.1.76"
 */
export function buildLineForField(
  group: IndexedParamGroup,
  index: number,
  suffix: string,
  value: string
): string {
  if (group.singleValue || !suffix) {
    return `${group.basePrefix}.${index} = ${value}`;
  }
  return `${group.basePrefix}.${index}.${suffix} = ${value}`;
}

/**
 * Build the full key string for a specific field.
 */
export function buildKeyForField(
  group: IndexedParamGroup,
  index: number,
  suffix: string
): string {
  if (group.singleValue || !suffix) {
    return `${group.basePrefix}.${index}`;
  }
  return `${group.basePrefix}.${index}.${suffix}`;
}
