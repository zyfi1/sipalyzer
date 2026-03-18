/**
 * Sanitize softphone dial input: normalizes pasted/typed values.
 * - Phone numbers: strip everything except digits and + * # (removes parens, dashes, dots, spaces, "x", "ext", etc.).
 * - SIP URIs (contains @): trim and allow only valid URI characters (alphanumeric, @ . - _ : + / ; =).
 */

const PHONE_ALLOWED = /[0-9+*#]/g;
const SIP_URI_ALLOWED = /[a-zA-Z0-9@.\-_:+/;=\s]/g;

/**
 * Sanitize value for the dial input field.
 * Use for both onChange and when appending keypad keys (value is already constrained by keypad, but paste may not be).
 */
export function sanitizeDialInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const looksLikeSipUri = trimmed.includes("@");
  if (looksLikeSipUri) {
    const kept = trimmed.match(SIP_URI_ALLOWED);
    return kept ? kept.join("").replace(/\s+/g, " ").trim() : "";
  }

  const kept = trimmed.match(PHONE_ALLOWED);
  return kept ? kept.join("") : "";
}
