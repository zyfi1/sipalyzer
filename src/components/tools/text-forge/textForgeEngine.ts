export type TextForgeSortTarget = "lines" | "tokens";
export type TextForgeSortOrder = "asc" | "desc";
export type TextForgePadDirection = "left" | "right";

export type TextForgeRule =
  | { type: "removeNumbers" }
  | { type: "removeLetters" }
  | { type: "trimExtraSpaces" }
  | { type: "toUppercase" }
  | { type: "toLowercase" }
  | { type: "toTitleCase" }
  | { type: "reverseText" }
  | { type: "reverseLines" }
  | { type: "reverseTokens" }
  | { type: "removeEmptyLines" }
  | { type: "dedupeLines" }
  | { type: "dedupeTokens" }
  | { type: "sortAlpha"; by: TextForgeSortTarget; order: TextForgeSortOrder }
  | { type: "sortNumeric"; by: TextForgeSortTarget; order: TextForgeSortOrder }
  | { type: "sortByLength"; by: TextForgeSortTarget; order: TextForgeSortOrder }
  | { type: "keepOnlyNumbers" }
  | { type: "keepOnlyLetters" }
  | { type: "keepAlphaNumeric" }
  | { type: "removePunctuation" }
  | { type: "findReplace"; find: string; replaceWith: string; caseSensitive: boolean }
  | { type: "addPrefixSuffixLines"; prefix: string; suffix: string }
  | { type: "wrapLines"; prefix: string; suffix: string }
  | { type: "lineNumbering"; startAt: number }
  | { type: "normalizeNewlines" }
  | { type: "slugify" }
  | { type: "extractEmails" }
  | { type: "extractUrls" }
  | { type: "urlEncode" }
  | { type: "urlDecode" }
  | { type: "base64Encode" }
  | { type: "base64Decode" }
  | { type: "groupByFirstCharacter" }
  | { type: "groupByLastCharacter" }
  | { type: "moveLettersToStart" }
  | { type: "moveLettersToEnd" }
  | { type: "moveNumbersToStart" }
  | { type: "moveNumbersToEnd" }
  | { type: "trimLines" }
  | { type: "collapseBlankLines"; maxConsecutive?: number }
  | { type: "removeNonAscii" }
  | { type: "removeDuplicateCharacters" }
  | { type: "htmlEscape" }
  | { type: "htmlUnescape" }
  | { type: "csvToLines" }
  | { type: "linesToCsv" }
  | { type: "sortIpAddresses"; order: TextForgeSortOrder }
  | { type: "extractNumbers" }
  | { type: "removeDiacritics" }
  | { type: "padLines"; direction: TextForgePadDirection; width: number; char?: string };

export interface TextForgeMetrics {
  words: number;
  chars: number;
  lines: number;
  numbers: number;
}

export interface TextForgeResult {
  text: string;
  metrics: TextForgeMetrics;
  appliedRules: readonly TextForgeRule[];
}

export class TextForgePipeline {
  private readonly input: string;
  private readonly rules: readonly TextForgeRule[];

  constructor(input: string, rules: readonly TextForgeRule[] = []) {
    this.input = input;
    this.rules = rules;
  }

  apply(rule: TextForgeRule): TextForgePipeline {
    return new TextForgePipeline(this.input, [...this.rules, rule]);
  }

  run(): TextForgeResult {
    return runTextForge(this.input, this.rules);
  }
}

export function createTextForgePipeline(input: string): TextForgePipeline {
  return new TextForgePipeline(input);
}

export function runTextForge(input: string, rules: readonly TextForgeRule[]): TextForgeResult {
  let text = input;

  for (const rule of rules) {
    text = applyRule(text, rule);
  }

  return {
    text,
    metrics: buildMetrics(text),
    appliedRules: [...rules],
  };
}

function applyRule(input: string, rule: TextForgeRule): string {
  switch (rule.type) {
    case "removeNumbers":
      return input.replace(/\d+/g, "");
    case "removeLetters":
      return input.replace(/[A-Za-z]+/g, "");
    case "trimExtraSpaces":
      return trimExtraSpaces(input);
    case "toUppercase":
      return input.toUpperCase();
    case "toLowercase":
      return input.toLowerCase();
    case "toTitleCase":
      return toTitleCase(input);
    case "reverseText":
      return [...input].reverse().join("");
    case "reverseLines":
      return reverseLines(input);
    case "reverseTokens":
      return reverseTokens(input);
    case "removeEmptyLines":
      return removeEmptyLines(input);
    case "dedupeLines":
      return dedupeLines(input);
    case "dedupeTokens":
      return dedupeTokens(input);
    case "sortAlpha":
      return sortAlpha(input, rule.by, rule.order);
    case "sortNumeric":
      return sortNumeric(input, rule.by, rule.order);
    case "sortByLength":
      return sortByLength(input, rule.by, rule.order);
    case "keepOnlyNumbers":
      return input.replace(/[^\d]+/g, "");
    case "keepOnlyLetters":
      return input.replace(/[^A-Za-z]+/g, "");
    case "keepAlphaNumeric":
      return input.replace(/[^A-Za-z0-9]+/g, "");
    case "removePunctuation":
      return input.replace(/[^A-Za-z0-9\s]+/g, "");
    case "findReplace":
      return findReplace(input, rule.find, rule.replaceWith, rule.caseSensitive);
    case "addPrefixSuffixLines":
      return decorateLines(input, rule.prefix, rule.suffix);
    case "wrapLines":
      return decorateLines(input, rule.prefix, rule.suffix);
    case "lineNumbering":
      return lineNumbering(input, rule.startAt);
    case "normalizeNewlines":
      return input.replace(/\r\n?/g, "\n");
    case "slugify":
      return slugify(input);
    case "extractEmails":
      return extractEmails(input).join("\n");
    case "extractUrls":
      return extractUrls(input).join("\n");
    case "urlEncode":
      return encodeURIComponent(input);
    case "urlDecode":
      return safelyDecodeURIComponent(input);
    case "base64Encode":
      return toBase64(input);
    case "base64Decode":
      return fromBase64(input);
    case "groupByFirstCharacter":
      return groupByCharacter(input, "first");
    case "groupByLastCharacter":
      return groupByCharacter(input, "last");
    case "moveLettersToStart":
      return reorderLettersAndNumbers(input, "letters-first");
    case "moveLettersToEnd":
      return reorderLettersAndNumbers(input, "numbers-first");
    case "moveNumbersToStart":
      return reorderLettersAndNumbers(input, "numbers-first");
    case "moveNumbersToEnd":
      return reorderLettersAndNumbers(input, "letters-first");
    case "trimLines":
      return trimLines(input);
    case "collapseBlankLines":
      return collapseBlankLines(input, rule.maxConsecutive ?? 1);
    case "removeNonAscii":
      return input.replace(/[^\x00-\x7F]+/g, "");
    case "removeDuplicateCharacters":
      return dedupeCharacters(input);
    case "htmlEscape":
      return htmlEscape(input);
    case "htmlUnescape":
      return htmlUnescape(input);
    case "csvToLines":
      return csvToLines(input);
    case "linesToCsv":
      return linesToCsv(input);
    case "sortIpAddresses":
      return sortIpAddresses(input, rule.order);
    case "extractNumbers":
      return extractNumbers(input).join("\n");
    case "removeDiacritics":
      return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    case "padLines":
      return padLines(input, rule.direction, rule.width, rule.char);
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

function buildMetrics(text: string): TextForgeMetrics {
  const wordMatches = text.match(/\S+/g) ?? [];
  const numberMatches = text.match(/-?\d+(?:\.\d+)?/g) ?? [];

  return {
    words: wordMatches.length,
    chars: text.length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
    numbers: numberMatches.length,
  };
}

function trimExtraSpaces(text: string): string {
  if (text.length === 0) {
    return "";
  }

  return splitLines(text)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
}

function trimLines(text: string): string {
  return splitLines(text)
    .map((line) => line.trim())
    .join("\n");
}

function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[A-Za-z]+/g, (word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`);
}

function reverseLines(text: string): string {
  return splitLines(text).reverse().join("\n");
}

function reverseTokens(text: string): string {
  return splitTokens(text).reverse().join(" ");
}

function removeEmptyLines(text: string): string {
  return splitLines(text)
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function collapseBlankLines(text: string, maxConsecutive: number): string {
  const lines = splitLines(text);
  const max = Math.max(0, Math.trunc(maxConsecutive));
  const result: string[] = [];
  let blankCount = 0;

  for (const line of lines) {
    if (line.trim().length === 0) {
      blankCount += 1;
      if (blankCount <= max) {
        result.push(line);
      }
      continue;
    }

    blankCount = 0;
    result.push(line);
  }

  return result.join("\n");
}

function dedupeLines(text: string): string {
  return dedupePreservingOrder(splitLines(text)).join("\n");
}

function dedupeTokens(text: string): string {
  return dedupePreservingOrder(splitTokens(text)).join(" ");
}

function dedupeCharacters(text: string): string {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const char of text) {
    if (!seen.has(char)) {
      seen.add(char);
      output.push(char);
    }
  }

  return output.join("");
}

function sortAlpha(text: string, by: TextForgeSortTarget, order: TextForgeSortOrder): string {
  const values = by === "lines" ? splitLines(text) : splitTokens(text);
  const sorted = stableSort(values, (left, right) => {
    const comparison = compareAlpha(left, right);
    return order === "asc" ? comparison : -comparison;
  });

  return by === "lines" ? sorted.join("\n") : sorted.join(" ");
}

function sortNumeric(text: string, by: TextForgeSortTarget, order: TextForgeSortOrder): string {
  const values = by === "lines" ? splitLines(text) : splitTokens(text);
  const sorted = stableSort(values, (left, right) => compareNumeric(left, right, order));
  return by === "lines" ? sorted.join("\n") : sorted.join(" ");
}

function sortByLength(text: string, by: TextForgeSortTarget, order: TextForgeSortOrder): string {
  const values = by === "lines" ? splitLines(text) : splitTokens(text);
  const sorted = stableSort(values, (left, right) => {
    const comparison = left.length - right.length;
    return order === "asc" ? comparison : -comparison;
  });
  return by === "lines" ? sorted.join("\n") : sorted.join(" ");
}

function sortIpAddresses(text: string, order: TextForgeSortOrder): string {
  const lines = splitLines(text);
  const sorted = stableSort(lines, (left, right) => {
    const leftIp = parseIpv4ToNumber(left);
    const rightIp = parseIpv4ToNumber(right);

    if (leftIp === null && rightIp === null) {
      return 0;
    }

    if (leftIp === null) {
      return 1;
    }

    if (rightIp === null) {
      return -1;
    }

    return order === "asc" ? leftIp - rightIp : rightIp - leftIp;
  });

  return sorted.join("\n");
}

function groupByCharacter(text: string, direction: "first" | "last"): string {
  const lines = splitLines(text);
  const grouped = stableSort(lines, (left, right) => {
    const leftKey = groupingKey(left, direction);
    const rightKey = groupingKey(right, direction);
    return compareAlpha(leftKey, rightKey);
  });
  return grouped.join("\n");
}

function reorderLettersAndNumbers(text: string, mode: "letters-first" | "numbers-first"): string {
  return text.replace(/[A-Za-z0-9]+/g, (token) => {
    const letters = token.replace(/[^A-Za-z]/g, "");
    const numbers = token.replace(/[^\d]/g, "");
    return mode === "letters-first" ? `${letters}${numbers}` : `${numbers}${letters}`;
  });
}

function parseIpv4ToNumber(value: string): number | null {
  const trimmed = value.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let total = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }

    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }

    total = total * 256 + octet;
  }

  return total;
}

function findReplace(input: string, find: string, replaceWith: string, caseSensitive: boolean): string {
  if (find.length === 0) {
    return input;
  }

  const flags = caseSensitive ? "g" : "gi";
  return input.replace(new RegExp(escapeRegExp(find), flags), replaceWith);
}

function decorateLines(text: string, prefix: string, suffix: string): string {
  return splitLines(text)
    .map((line) => `${prefix}${line}${suffix}`)
    .join("\n");
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlUnescape(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function csvToLines(input: string): string {
  return parseSimpleCsvRow(input).join("\n");
}

function linesToCsv(input: string): string {
  return splitLines(input).map(escapeCsvValue).join(",");
}

function parseSimpleCsvRow(input: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === '"') {
      const next = input[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function escapeCsvValue(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function extractNumbers(text: string): string[] {
  const matches = text.match(/[+-]?\d+(?:\.\d+)?/g) ?? [];
  return matches.map((value) => (value.startsWith("+") ? value.slice(1) : value));
}

function lineNumbering(text: string, startAt: number): string {
  return splitLines(text)
    .map((line, index) => `${startAt + index}. ${line}`)
    .join("\n");
}

function padLines(text: string, direction: TextForgePadDirection, width: number, char = " "): string {
  const finalWidth = Math.max(0, Math.trunc(width));
  const fillChar = (char[0] ?? " ").toString();

  return splitLines(text)
    .map((line) => (direction === "left" ? line.padStart(finalWidth, fillChar) : line.padEnd(finalWidth, fillChar)))
    .join("\n");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return dedupePreservingOrder(matches.map((value) => value.trim()));
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s]+/gi) ?? [];
  return dedupePreservingOrder(
    matches
      .map((value) => value.trim().replace(/[),.;!?]+$/g, ""))
      .filter(Boolean),
  );
}

function safelyDecodeURIComponent(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join("");
  return btoa(binary);
}

function fromBase64(input: string): string {
  try {
    const binary = atob(input);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return input;
  }
}

function compareAlpha(left: string, right: string): number {
  const leftValue = left.toLowerCase();
  const rightValue = right.toLowerCase();

  if (leftValue < rightValue) {
    return -1;
  }

  if (leftValue > rightValue) {
    return 1;
  }

  return 0;
}

function compareNumeric(left: string, right: string, order: TextForgeSortOrder): number {
  const leftNumber = extractNumber(left);
  const rightNumber = extractNumber(right);

  if (leftNumber === null && rightNumber === null) {
    return 0;
  }

  if (leftNumber === null) {
    return 1;
  }

  if (rightNumber === null) {
    return -1;
  }

  return order === "asc" ? leftNumber - rightNumber : rightNumber - leftNumber;
}

function extractNumber(value: string): number | null {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function groupingKey(value: string, direction: "first" | "last"): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return "";
  }

  if (direction === "first") {
    return trimmed[0] ?? "";
  }

  return trimmed[trimmed.length - 1] ?? "";
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  return text.split("\n");
}

function splitTokens(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }

  return trimmed.split(/\s+/);
}

function dedupePreservingOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableSort<T>(items: readonly T[], compare: (left: T, right: T) => number): T[] {
  return items
    .map((value, index) => ({ value, index }))
    .sort((left, right) => {
      const result = compare(left.value, right.value);
      if (result !== 0) {
        return result;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.value);
}
