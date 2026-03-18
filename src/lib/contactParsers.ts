/**
 * Contact parsers for importing from various formats
 * Supports CSV, vCard, and clipboard (TSV) formats
 */

export interface ParsedContact {
  name: string;
  phone: string;
  email?: string;
  company?: string;
  notes?: string;
}

export interface ParseResult {
  contacts: ParsedContact[];
  errors: string[];
  warnings: string[];
}

// ============================================================================
// CSV Parser
// ============================================================================

interface CSVParseOptions {
  /** Column index or name for the name field */
  nameColumn?: string | number;
  /** Column index or name for the phone field */
  phoneColumn?: string | number;
  /** Column index or name for the email field */
  emailColumn?: string | number;
  /** Column index or name for the company field */
  companyColumn?: string | number;
  /** Whether the first row is a header */
  hasHeader?: boolean;
}

/**
 * Parse CSV content into rows, handling quoted fields and escaped characters
 */
function parseCSVRows(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i += 2;
      } else if (char === '"') {
        // End of quoted field
        inQuotes = false;
        i++;
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
        i++;
      } else if (char === ",") {
        // Field separator
        currentRow.push(currentField.trim());
        currentField = "";
        i++;
      } else if (char === "\r" && nextChar === "\n") {
        // Windows line ending
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
        i += 2;
      } else if (char === "\n" || char === "\r") {
        // Unix/Mac line ending
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Handle last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Auto-detect column mappings from header row
 */
function autoDetectCSVColumns(headers: string[]): {
  name?: number;
  phone?: number;
  email?: number;
  company?: number;
} {
  const result: { name?: number; phone?: number; email?: number; company?: number } = {};
  
  const namePatterns = [/^name$/i, /^full\s*name$/i, /^display\s*name$/i, /^contact\s*name$/i, /^first.*last/i];
  const phonePatterns = [/^phone$/i, /^telephone$/i, /^mobile$/i, /^cell$/i, /phone\s*number/i, /^tel$/i, /^primary.*phone/i];
  const emailPatterns = [/^e?-?mail$/i, /^email\s*address$/i, /^e-mail\s*address$/i];
  const companyPatterns = [/^company$/i, /^organization$/i, /^org$/i, /^employer$/i, /^business$/i];

  headers.forEach((header, idx) => {
    const h = header.toLowerCase().trim();
    if (result.name === undefined && namePatterns.some((p) => p.test(h))) {
      result.name = idx;
    }
    if (result.phone === undefined && phonePatterns.some((p) => p.test(h))) {
      result.phone = idx;
    }
    if (result.email === undefined && emailPatterns.some((p) => p.test(h))) {
      result.email = idx;
    }
    if (result.company === undefined && companyPatterns.some((p) => p.test(h))) {
      result.company = idx;
    }
  });

  // Fallback: try first/last name combination
  if (result.name === undefined) {
    const firstIdx = headers.findIndex((h) => /^first\s*name$/i.test(h));
    const lastIdx = headers.findIndex((h) => /^last\s*name$/i.test(h));
    if (firstIdx !== -1 || lastIdx !== -1) {
      // Mark as special case - we'll combine them
      result.name = firstIdx !== -1 ? firstIdx : lastIdx;
    }
  }

  return result;
}

/**
 * Parse CSV content into contacts
 */
export function parseCSV(content: string, options: CSVParseOptions = {}): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const contacts: ParsedContact[] = [];

  const rows = parseCSVRows(content);
  if (rows.length === 0) {
    errors.push("No data found in CSV");
    return { contacts, errors, warnings };
  }

  // Detect if first row is header
  const firstRow = rows[0] || [];
  const hasHeader = options.hasHeader ?? firstRow.some((cell) =>
    /^(name|phone|email|company|first|last|tel|mobile)/i.test(cell)
  );

  let headers: string[] = [];
  let dataRows = rows;
  
  if (hasHeader) {
    headers = firstRow;
    dataRows = rows.slice(1);
  }

  // Get column mappings
  let nameCol: number | undefined;
  let phoneCol: number | undefined;
  let emailCol: number | undefined;
  let companyCol: number | undefined;
  let firstNameCol: number | undefined;
  let lastNameCol: number | undefined;

  if (hasHeader) {
    const detected = autoDetectCSVColumns(headers);
    nameCol = detected.name;
    phoneCol = detected.phone;
    emailCol = detected.email;
    companyCol = detected.company;

    // Check for first/last name combination
    firstNameCol = headers.findIndex((h) => /^first\s*name$/i.test(h));
    lastNameCol = headers.findIndex((h) => /^last\s*name$/i.test(h));
    if (firstNameCol === -1) firstNameCol = undefined;
    if (lastNameCol === -1) lastNameCol = undefined;
  }

  // Apply manual overrides
  if (options.nameColumn !== undefined) {
    nameCol = typeof options.nameColumn === "number"
      ? options.nameColumn
      : headers.findIndex((h) => h.toLowerCase() === options.nameColumn?.toString().toLowerCase());
  }
  if (options.phoneColumn !== undefined) {
    phoneCol = typeof options.phoneColumn === "number"
      ? options.phoneColumn
      : headers.findIndex((h) => h.toLowerCase() === options.phoneColumn?.toString().toLowerCase());
  }
  if (options.emailColumn !== undefined) {
    emailCol = typeof options.emailColumn === "number"
      ? options.emailColumn
      : headers.findIndex((h) => h.toLowerCase() === options.emailColumn?.toString().toLowerCase());
  }
  if (options.companyColumn !== undefined) {
    companyCol = typeof options.companyColumn === "number"
      ? options.companyColumn
      : headers.findIndex((h) => h.toLowerCase() === options.companyColumn?.toString().toLowerCase());
  }

  // Validate required columns
  const hasNameSource = nameCol !== undefined || (firstNameCol !== undefined || lastNameCol !== undefined);
  if (!hasNameSource) {
    warnings.push("Could not auto-detect name column. Using first column.");
    nameCol = 0;
  }
  if (phoneCol === undefined) {
    warnings.push("Could not auto-detect phone column. Using second column.");
    phoneCol = 1;
  }

  // Parse data rows
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row) continue;
    
    // Build name from first/last if available
    let name = "";
    if (firstNameCol !== undefined || lastNameCol !== undefined) {
      const first = firstNameCol !== undefined ? (row[firstNameCol] ?? "").trim() : "";
      const last = lastNameCol !== undefined ? (row[lastNameCol] ?? "").trim() : "";
      name = [first, last].filter(Boolean).join(" ");
    } else if (nameCol !== undefined) {
      name = (row[nameCol] ?? "").trim();
    }

    const phone = phoneCol !== undefined ? (row[phoneCol] ?? "").trim() : "";
    const email = emailCol !== undefined ? (row[emailCol] ?? "").trim() : undefined;
    const company = companyCol !== undefined ? (row[companyCol] ?? "").trim() : undefined;

    if (!name && !phone) {
      continue; // Skip empty rows
    }

    if (!phone) {
      warnings.push(`Row ${i + 1 + (hasHeader ? 1 : 0)}: Missing phone number for "${name}"`);
      continue;
    }

    contacts.push({
      name: name || "Unknown",
      phone,
      email: email || undefined,
      company: company || undefined,
    });
  }

  return { contacts, errors, warnings };
}

/**
 * Get column headers from CSV for mapping UI
 */
export function getCSVHeaders(content: string): string[] {
  const rows = parseCSVRows(content);
  return rows[0] || [];
}

/**
 * Get preview of CSV data (first few rows)
 */
export function getCSVPreview(content: string, maxRows = 5): string[][] {
  const rows = parseCSVRows(content);
  return rows.slice(0, maxRows + 1); // +1 for header
}

// ============================================================================
// vCard Parser
// ============================================================================

interface VCardProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * Parse a single vCard property line
 */
function parseVCardLine(line: string): VCardProperty | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;

  const nameParams = line.substring(0, colonIdx);
  const value = line.substring(colonIdx + 1);

  const semicolonIdx = nameParams.indexOf(";");
  const name = semicolonIdx === -1 ? nameParams : nameParams.substring(0, semicolonIdx);
  
  const params: Record<string, string> = {};
  if (semicolonIdx !== -1) {
    const paramParts = nameParams.substring(semicolonIdx + 1).split(";");
    for (const part of paramParts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx !== -1) {
        params[part.substring(0, eqIdx).toUpperCase()] = part.substring(eqIdx + 1);
      } else {
        // vCard 2.1 style: TYPE without =
        params[part.toUpperCase()] = "true";
      }
    }
  }

  return { name: name.toUpperCase(), params, value };
}

/**
 * Unfold vCard lines (handle line continuations)
 */
function unfoldVCard(content: string): string {
  // RFC 6350: lines that start with space or tab are continuations
  return content.replace(/\r?\n[ \t]/g, "");
}

/**
 * Decode vCard value (handle encoding)
 */
function decodeVCardValue(value: string, encoding?: string): string {
  if (encoding?.toUpperCase() === "QUOTED-PRINTABLE") {
    // Decode quoted-printable
    return value
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/=\r?\n/g, "");
  }
  return value;
}

/**
 * Parse vCard content into contacts (supports multiple vCards in one file)
 */
export function parseVCard(content: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const contacts: ParsedContact[] = [];

  const unfolded = unfoldVCard(content);
  const lines = unfolded.split(/\r?\n/);

  let currentContact: Partial<ParsedContact> | null = null;
  let phones: Array<{ value: string; type: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const prop = parseVCardLine(trimmed);
    if (!prop) continue;

    if (prop.name === "BEGIN" && prop.value.toUpperCase() === "VCARD") {
      currentContact = {};
      phones = [];
      continue;
    }

    if (prop.name === "END" && prop.value.toUpperCase() === "VCARD") {
      if (currentContact) {
        // Select best phone (prefer CELL > WORK > HOME > any)
        let bestPhone = phones.find((p) => p.type.includes("CELL") || p.type.includes("MOBILE"));
        if (!bestPhone) bestPhone = phones.find((p) => p.type.includes("WORK"));
        if (!bestPhone) bestPhone = phones.find((p) => p.type.includes("HOME"));
        if (!bestPhone && phones.length > 0) bestPhone = phones[0];

        if (currentContact.name && bestPhone) {
          contacts.push({
            name: currentContact.name,
            phone: bestPhone.value,
            email: currentContact.email,
            company: currentContact.company,
            notes: currentContact.notes,
          });
        } else if (currentContact.name) {
          warnings.push(`Contact "${currentContact.name}" has no phone number`);
        }
      }
      currentContact = null;
      phones = [];
      continue;
    }

    if (!currentContact) continue;

    const encoding = prop.params.ENCODING;
    const decodedValue = decodeVCardValue(prop.value, encoding);

    switch (prop.name) {
      case "FN":
        // Formatted name - use as-is
        currentContact.name = decodedValue;
        break;

      case "N":
        // Structured name: Last;First;Middle;Prefix;Suffix
        if (!currentContact.name) {
          const parts = decodedValue.split(";");
          const last = parts[0] || "";
          const first = parts[1] || "";
          const middle = parts[2] || "";
          currentContact.name = [first, middle, last].filter(Boolean).join(" ").trim();
        }
        break;

      case "TEL":
        phones.push({
          value: decodedValue.replace(/[^\d+\-() ]/g, "").trim(),
          type: Object.keys(prop.params).join(","),
        });
        break;

      case "EMAIL":
        if (!currentContact.email) {
          currentContact.email = decodedValue;
        }
        break;

      case "ORG":
        // Organization: Company;Department
        currentContact.company = decodedValue.split(";")[0];
        break;

      case "NOTE":
        currentContact.notes = decodedValue;
        break;
    }
  }

  if (contacts.length === 0 && !errors.length) {
    errors.push("No valid contacts found in vCard file");
  }

  return { contacts, errors, warnings };
}

// ============================================================================
// Clipboard / TSV Parser
// ============================================================================

/**
 * Parse clipboard content (tab-separated values from Excel/Sheets)
 */
export function parseClipboard(content: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const contacts: ParsedContact[] = [];

  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) {
    errors.push("No data found in clipboard");
    return { contacts, errors, warnings };
  }

  // Split by tabs
  const rows = lines.map((line) => line.split("\t").map((cell) => cell.trim()));

  // Check if first row looks like headers
  const firstRow = rows[0] || [];
  const hasHeader = firstRow.some((cell) =>
    /^(name|phone|email|company|first|last|tel|mobile)/i.test(cell)
  );

  let headers: string[] = [];
  let dataRows = rows;

  if (hasHeader) {
    headers = firstRow;
    dataRows = rows.slice(1);
  }

  // Auto-detect columns
  let nameCol: number | undefined;
  let phoneCol: number | undefined;
  let emailCol: number | undefined;
  let companyCol: number | undefined;

  if (hasHeader) {
    const detected = autoDetectCSVColumns(headers);
    nameCol = detected.name;
    phoneCol = detected.phone;
    emailCol = detected.email;
    companyCol = detected.company;
  }

  // Fallback to positional if no headers
  if (nameCol === undefined) nameCol = 0;
  if (phoneCol === undefined) phoneCol = 1;
  if (emailCol === undefined && (hasHeader ? headers.length : (dataRows[0]?.length || 0)) > 2) {
    emailCol = 2;
  }
  if (companyCol === undefined && (hasHeader ? headers.length : (dataRows[0]?.length || 0)) > 3) {
    companyCol = 3;
  }

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row) continue;
    const name = nameCol !== undefined ? (row[nameCol] ?? "").trim() : "";
    const phone = phoneCol !== undefined ? (row[phoneCol] ?? "").trim() : "";
    const email = emailCol !== undefined ? (row[emailCol] ?? "").trim() : undefined;
    const company = companyCol !== undefined ? (row[companyCol] ?? "").trim() : undefined;

    if (!name && !phone) continue;

    if (!phone) {
      warnings.push(`Row ${i + 1 + (hasHeader ? 1 : 0)}: Missing phone number for "${name}"`);
      continue;
    }

    contacts.push({
      name: name || "Unknown",
      phone,
      email: email || undefined,
      company: company || undefined,
    });
  }

  return { contacts, errors, warnings };
}

// ============================================================================
// File type detection
// ============================================================================

/**
 * Detect file type from content or filename
 */
export function detectFileType(content: string, filename?: string): "csv" | "vcard" | "unknown" {
  // Check filename extension
  if (filename) {
    const ext = filename.toLowerCase().split(".").pop();
    if (ext === "csv") return "csv";
    if (ext === "vcf" || ext === "vcard") return "vcard";
  }

  // Check content
  const trimmed = content.trim();
  if (trimmed.startsWith("BEGIN:VCARD")) return "vcard";
  
  // CSV detection: check for comma-separated structure
  const firstLine = trimmed.split(/\r?\n/)[0] || "";
  if (firstLine.includes(",") && !firstLine.includes(":")) return "csv";

  return "unknown";
}

/**
 * Parse file content automatically based on type detection
 */
export function parseContactFile(content: string, filename?: string): ParseResult {
  const fileType = detectFileType(content, filename);

  switch (fileType) {
    case "csv":
      return parseCSV(content);
    case "vcard":
      return parseVCard(content);
    default:
      return {
        contacts: [],
        errors: [`Unknown file format. Please use CSV or vCard (.vcf) files.`],
        warnings: [],
      };
  }
}
