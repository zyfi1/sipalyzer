/**
 * Provision Contact Utilities
 *
 * Shared parsing, detection, and mapping logic for provision device contacts.
 * Used by both the Provision Viewer (Contacts tab) and the Softphone (import modal).
 */

// ── Types ───────────────────────────────────────────────────────────────────

/** One parsed contact from a Yealink XML or CSV phonebook. */
export interface ParsedContact {
  displayName: string;
  office?: string;
  mobile?: string;
  other?: string;
}

// ── XML Helpers ─────────────────────────────────────────────────────────────

/** Get text content of first matching XML tag (case-insensitive). */
function getXmlTag(entry: string | undefined, tag: string | undefined): string | undefined {
  const e = entry ?? "";
  const t = tag ?? "";
  if (!t) return undefined;
  const re = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i");
  const m = e.match(re);
  return m ? (m[1] ?? "").replace(/<[^>]+>/g, "").trim() : undefined;
}

/** Get attribute value from tag string (e.g. 'display_name="John" office_number="123"'). */
function getXmlAttr(tagStr: string | undefined, attr: string | undefined): string | undefined {
  const s = tagStr ?? "";
  const a = attr ?? "";
  if (!a) return undefined;
  const re = new RegExp(`${a}\\s*=\\s*["']([^"']*)["']`, "i");
  const m = s.match(re);
  return m ? (m[1] ?? "").trim() : undefined;
}

// ── Contact Parser ──────────────────────────────────────────────────────────

/** Parse XML phonebook (Yealink, Poly, DirectoryEntry, attribute-style Contact, CSV). */
export function parseContactsFile(content: string): ParsedContact[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // ── Poly local directory: <item><fn>Name</fn><ct>Number</ct>...</item> ──
  if (/<item\b/i.test(trimmed) && (/<fn>/i.test(trimmed) || /<ct>/i.test(trimmed))) {
    const polyContacts = parsePolyLocalDirectory(trimmed);
    if (polyContacts.length) return polyContacts;
  }

  const nameTags = ["Name", "display_name", "DisplayName", "name", "title", "fn"];
  const phoneTags = ["Number", "Telephone", "office_number", "phone", "Phone", "number", "tel", "ct", "Contact"];
  const mobileTags = ["mobile_number", "mobile", "Mobile", "cell"];
  const otherTags = ["other_number", "other", "Other"];

  const parseXmlEntries = (
    xml: string,
    entryTag: string,
    names: string[],
    phones: string[],
    mobiles: string[],
    others: string[]
  ): ParsedContact[] => {
    const contacts: ParsedContact[] = [];
    const entryRegex = new RegExp(`<${entryTag}([^>]*)>([\\s\\S]*?)</${entryTag}>`, "gi");
    let m: RegExpExecArray | null;
    while ((m = entryRegex.exec(xml)) !== null) {
      const attrs = m[1] ?? "";
      const inner = m[2] ?? "";
      let name = "";
      for (const t of names) {
        const tag = t ?? "";
        const v = getXmlTag(inner, tag) ?? getXmlAttr(attrs, tag);
        if (v) {
          name = v;
          break;
        }
      }
      const safeInner = inner ?? "";
      const safeAttrs = attrs ?? "";
      const office =
        phones.map((t) => getXmlTag(safeInner, (t ?? "")) ?? getXmlAttr(safeAttrs, (t ?? ""))).find(Boolean);
      const mobile = mobiles.map((t) => getXmlTag(safeInner, (t ?? "")) ?? getXmlAttr(safeAttrs, (t ?? ""))).find(Boolean);
      const other = others.map((t) => getXmlTag(safeInner, (t ?? "")) ?? getXmlAttr(safeAttrs, (t ?? ""))).find(Boolean);
      if (name || office) {
        contacts.push({
          displayName: name || office || "—",
          office: office ?? undefined,
          mobile: mobile ?? undefined,
          other: other ?? undefined,
        });
      }
    }
    return contacts;
  };

  const isXml = trimmed.startsWith("<?xml") || (trimmed.startsWith("<") && /<\w+/.test(trimmed));
  if (isXml) {
    // Yealink standard (888voip, etc.): <Phonelist><Contact><Name>...</Name><Number>...</Number></Contact></Phonelist>
    if (/<Phonelist/i.test(trimmed) || /<Contact\s/i.test(trimmed)) {
      const list = parseXmlEntries(trimmed, "Contact", nameTags, phoneTags, mobileTags, otherTags);
      if (list.length) return list;
    }
    // Yealink/Yeastar: DirectoryEntry with Name, Telephone
    if (/<DirectoryEntry/i.test(trimmed)) {
      const list = parseXmlEntries(trimmed, "DirectoryEntry", nameTags, phoneTags, mobileTags, otherTags);
      if (list.length) return list;
    }
    // Attribute-only Contact: <Contact display_name="..." office_number="..."/>
    const selfCloseRegex = /<Contact\s+([^>]+?)\s*\/>/gi;
    let mc: RegExpExecArray | null;
    const attrContacts: ParsedContact[] = [];
    while ((mc = selfCloseRegex.exec(trimmed)) !== null) {
      const attrs = mc[1];
      const name =
        getXmlAttr(attrs, "display_name") ?? getXmlAttr(attrs, "name") ?? getXmlAttr(attrs, "Name") ?? "";
      const office =
        getXmlAttr(attrs, "office_number") ?? getXmlAttr(attrs, "phone") ?? getXmlAttr(attrs, "Number");
      const mobile = getXmlAttr(attrs, "mobile_number") ?? getXmlAttr(attrs, "mobile");
      const other = getXmlAttr(attrs, "other_number") ?? getXmlAttr(attrs, "other");
      if (name || office) {
        attrContacts.push({
          displayName: name || office || "—",
          office: office ?? undefined,
          mobile: mobile ?? undefined,
          other: other ?? undefined,
        });
      }
    }
    if (attrContacts.length) return attrContacts;
    // Generic: item, entry, ContactEntry
    for (const entryTag of ["item", "Item", "entry", "Entry", "ContactEntry"]) {
      if (new RegExp(`<${entryTag}[^>]*>`, "i").test(trimmed)) {
        const list = parseXmlEntries(trimmed, entryTag, nameTags, phoneTags, mobileTags, otherTags);
        if (list.length) return list;
      }
    }
  }

  // CSV: assume header row with name, number(s); try "Name","Phone" or name,phone, etc.
  if (trimmed.includes(",") || trimmed.includes(";")) {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const header = (lines[0] ?? "").toLowerCase();
    const sep = header.includes(";") ? ";" : ",";
    const cols = (lines[0] ?? "").split(sep).map((c) => c.replace(/^["']|["']$/g, "").trim().toLowerCase());
    const nameIdx = cols.findIndex((c) => c === "name" || c === "display_name" || c === "display name");
    const phoneIdx = cols.findIndex((c) => c === "phone" || c === "telephone" || c === "number" || c === "office");
    const mobileIdx = cols.findIndex((c) => c === "mobile" || c === "cell");
    if (nameIdx === -1 && phoneIdx === -1) return [];
    const contacts: ParsedContact[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const cells = line.split(sep).map((c) => c.replace(/^["']|["']$/g, "").trim());
      const displayName = (nameIdx >= 0 ? (cells[nameIdx] ?? "") : "") || (phoneIdx >= 0 ? (cells[phoneIdx] ?? "") : "") || "";
      const office = phoneIdx >= 0 ? (cells[phoneIdx] ?? undefined) : undefined;
      const mobile = mobileIdx >= 0 ? (cells[mobileIdx] ?? undefined) : undefined;
      if (displayName || office) {
        contacts.push({ displayName: displayName || (office ?? "") || "—", office, mobile });
      }
    }
    return contacts;
  }

  return [];
}

// ── Phone Number Detection ──────────────────────────────────────────────────

/** Check if a number string is a "real" phone number (7+ digits). */
export function isRealPhoneNumber(num: string | undefined): boolean {
  if (!num) return false;
  const digits = num.replace(/\D/g, "");
  return digits.length >= 7;
}

/** Check if a parsed contact has at least one real phone number. */
export function hasRealPhoneNumber(contact: ParsedContact): boolean {
  return (
    isRealPhoneNumber(contact.office) ||
    isRealPhoneNumber(contact.mobile) ||
    isRealPhoneNumber(contact.other)
  );
}

/**
 * Pick the best phone number from a parsed contact.
 * Prefers real phone numbers (7+ digits), office → mobile → other.
 * Falls back to first non-empty number in "include extensions" mode.
 */
export function getBestPhone(contact: ParsedContact, includeExtensions = false): string | null {
  // First pass: real numbers only
  for (const num of [contact.office, contact.mobile, contact.other]) {
    if (isRealPhoneNumber(num)) return num!;
  }
  // Second pass: any non-empty (extension mode)
  if (includeExtensions) {
    return contact.office || contact.mobile || contact.other || null;
  }
  return null;
}

/**
 * Convert a ParsedContact to the shape expected by useContactsStore.importContacts().
 * Returns null if no usable phone number is found.
 */
export function parsedContactToImport(
  contact: ParsedContact,
  includeExtensions = false
): { name: string; phone: string; notes?: string } | null {
  const phone = getBestPhone(contact, includeExtensions);
  if (!phone) return null;

  // Build notes from remaining numbers
  const parts: string[] = [];
  if (contact.office && contact.office !== phone) parts.push(`Office: ${contact.office}`);
  if (contact.mobile && contact.mobile !== phone) parts.push(`Mobile: ${contact.mobile}`);
  if (contact.other && contact.other !== phone) parts.push(`Other: ${contact.other}`);
  const notes = parts.length > 0 ? parts.join(", ") : undefined;

  return {
    name: contact.displayName,
    phone,
    notes,
  };
}

// ── Poly-specific parsers ────────────────────────────────────────────────

/**
 * Parse Poly local directory XML.
 * Format: <item><fn>Display Name</fn><ct>12345</ct><sd>1</sd><rt>7</rt>...</item>
 * - fn = first name / display name
 * - ln = last name (optional)
 * - ct = contact number (phone)
 * - sd = speed dial index
 * - rt = ring type
 */
function parsePolyLocalDirectory(xml: string): ParsedContact[] {
  const contacts: ParsedContact[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const inner = m[1] ?? "";
    const fn_ = getXmlTagSimple(inner, "fn");
    const ln = getXmlTagSimple(inner, "ln");
    const ct = getXmlTagSimple(inner, "ct");
    const displayName = [fn_, ln].filter(Boolean).join(" ").trim();
    if (displayName || ct) {
      contacts.push({
        displayName: displayName || ct || "—",
        office: ct ?? undefined,
      });
    }
  }
  return contacts;
}

/** Simple XML tag extractor (case-insensitive). */
function getXmlTagSimple(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? (m[1] ?? "").trim() || undefined : undefined;
}
