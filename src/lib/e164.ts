/**
 * E.164 (ITU-T) compliant phone number handling.
 * - Max 15 digits for international numbers.
 * - Leading + for international form; national prefix (leading 0) stripped.
 * - RFC 3966 (tel: URI) compatible.
 */

/** Max E.164 digit length (ITU-T E.164). */
export const E164_MAX_DIGITS = 15;

/**
 * Extract digits only from input (strips spaces, dashes, parentheses, dots, +).
 */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * NANP (North American): 10 digits with first digit 2–9 = US/Canada, add country code 1.
 */
function isNanp10Digits(digits: string): boolean {
  if (digits.length !== 10) return false;
  const first = digits.charCodeAt(0) - 48;
  return first >= 2 && first <= 9;
}

/**
 * Normalize to E.164 canonical form:
 * - Digits only, max 15; strip national prefix (one leading 0) per E.164; add + for 10–15 digits.
 * - Smart dialing: 10-digit US/NANP number (2–9 + 9 digits) gets country code 1 prepended.
 * - 1–9 digits left as-is (extension/short code).
 * - Empty or no digits returns empty string.
 */
export function normalizeE164(input: string): string {
  const digits = digitsOnly(input.trim());
  if (digits.length === 0) return "";
  const withoutNationalZero = digits.startsWith("0") && digits.length > 1 ? digits.slice(1) : digits;
  let canonical = withoutNationalZero.slice(0, E164_MAX_DIGITS);
  if (canonical.length === 10 && isNanp10Digits(canonical)) {
    canonical = "1" + canonical;
  }
  if (canonical.length >= 10) {
    return `+${canonical}`;
  }
  return canonical;
}

/**
 * Check if a string looks like an E.164 international number (10–15 digits, optional leading +).
 */
export function isE164International(input: string): boolean {
  const digits = digitsOnly(input.trim());
  const len = digits.replace(/^0+/, "").length || 0;
  return len >= 10 && len <= E164_MAX_DIGITS;
}

/**
 * Format for display (e.g. +1 555 123 4567) without changing the canonical value.
 * Keeps input as-is if it contains non-digit separators; otherwise adds space after country code for long numbers.
 */
export function formatE164Display(canonical: string): string {
  const d = digitsOnly(canonical);
  if (d.length === 0) return canonical;
  if (d.length >= 10 && d.length <= E164_MAX_DIGITS) {
    const withPlus = d.replace(/^0+/, "");
    if (withPlus.length >= 10) {
      return `+${withPlus.slice(0, E164_MAX_DIGITS)}`;
    }
  }
  return canonical;
}

const SIP_URI_PATTERN = /^\s*sips?:|@/i;

/**
 * Normalize dial input before sending to backend: E.164 for numbers, trim-only for SIP URIs.
 * Feature/star codes (containing * or #, e.g. *95, #31#) are passed through verbatim —
 * they are PBX dial strings, not phone numbers.
 */
export function normalizeDialInput(input: string): string {
  const s = input.trim();
  if (!s) return s;
  if (SIP_URI_PATTERN.test(s)) return s;
  // Star/hash codes are PBX feature codes — don't strip * or # via E.164 normalization
  if (s.includes("*") || s.includes("#")) return s;
  const normalized = normalizeE164(s);
  return normalized || s;
}
