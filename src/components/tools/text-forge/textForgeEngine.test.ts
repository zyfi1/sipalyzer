import { describe, expect, it } from "vitest";
import { createTextForgePipeline, runTextForge, type TextForgeRule } from "@/components/tools/text-forge/textForgeEngine";

describe("textForgeEngine", () => {
  it("supports a typed, chainable pipeline", () => {
    const result = createTextForgePipeline("a1   b2")
      .apply({ type: "removeNumbers" })
      .apply({ type: "trimExtraSpaces" })
      .run();

    expect(result.text).toBe("a b");
  });

  it("reports deterministic metrics counts", () => {
    const result = runTextForge("alpha 20\nbeta 3", []);
    expect(result.metrics).toEqual({
      words: 4,
      chars: 15,
      lines: 2,
      numbers: 2,
    });
  });

  it("removes numbers", () => {
    const result = runTextForge("ab12 cd3", [{ type: "removeNumbers" }]);
    expect(result.text).toBe("ab cd");
  });

  it("removes letters", () => {
    const result = runTextForge("ab12 cd3", [{ type: "removeLetters" }]);
    expect(result.text).toBe("12 3");
  });

  it("trims extra spaces while preserving lines", () => {
    const result = runTextForge("  one   two \nthree    four  ", [{ type: "trimExtraSpaces" }]);
    expect(result.text).toBe("one two\nthree four");
  });

  it("sorts alpha asc and desc by lines", () => {
    const asc = runTextForge("banana\nApple\ncherry", [{ type: "sortAlpha", by: "lines", order: "asc" }]);
    const desc = runTextForge("banana\nApple\ncherry", [{ type: "sortAlpha", by: "lines", order: "desc" }]);
    expect(asc.text).toBe("Apple\nbanana\ncherry");
    expect(desc.text).toBe("cherry\nbanana\nApple");
  });

  it("sorts alpha asc and desc by tokens", () => {
    const asc = runTextForge("banana Apple cherry", [{ type: "sortAlpha", by: "tokens", order: "asc" }]);
    const desc = runTextForge("banana Apple cherry", [{ type: "sortAlpha", by: "tokens", order: "desc" }]);
    expect(asc.text).toBe("Apple banana cherry");
    expect(desc.text).toBe("cherry banana Apple");
  });

  it("sorts numeric asc and desc by lines, keeping non-numeric content stable", () => {
    const input = "20 dogs\n3 cats\nno number\n10 birds";
    const asc = runTextForge(input, [{ type: "sortNumeric", by: "lines", order: "asc" }]);
    const desc = runTextForge(input, [{ type: "sortNumeric", by: "lines", order: "desc" }]);
    expect(asc.text).toBe("3 cats\n10 birds\n20 dogs\nno number");
    expect(desc.text).toBe("20 dogs\n10 birds\n3 cats\nno number");
  });

  it("sorts numeric asc and desc by tokens, keeping non-numeric content stable", () => {
    const input = "x 20 3 foo 10";
    const asc = runTextForge(input, [{ type: "sortNumeric", by: "tokens", order: "asc" }]);
    const desc = runTextForge(input, [{ type: "sortNumeric", by: "tokens", order: "desc" }]);
    expect(asc.text).toBe("3 10 20 x foo");
    expect(desc.text).toBe("20 10 3 x foo");
  });

  it("groups by first character", () => {
    const result = runTextForge("beta\nalpha\navocado\ncherry\nbanana", [{ type: "groupByFirstCharacter" }]);
    expect(result.text).toBe("alpha\navocado\nbeta\nbanana\ncherry");
  });

  it("groups by last character", () => {
    const result = runTextForge("car\nstar\nbeta\nzeta\ndog", [{ type: "groupByLastCharacter" }]);
    expect(result.text).toBe("beta\nzeta\ndog\ncar\nstar");
  });

  it("moves letters and numbers to start and end", () => {
    const input = "a1b2 55xx x9y";
    expect(runTextForge(input, [{ type: "moveLettersToStart" }]).text).toBe("ab12 xx55 xy9");
    expect(runTextForge(input, [{ type: "moveLettersToEnd" }]).text).toBe("12ab 55xx 9xy");
    expect(runTextForge(input, [{ type: "moveNumbersToStart" }]).text).toBe("12ab 55xx 9xy");
    expect(runTextForge(input, [{ type: "moveNumbersToEnd" }]).text).toBe("ab12 xx55 xy9");
  });

  it("keeps behavior stable for empty and mixed input", () => {
    const rules: TextForgeRule[] = [
      { type: "removeNumbers" },
      { type: "sortAlpha", by: "tokens", order: "asc" },
      { type: "groupByFirstCharacter" },
      { type: "moveNumbersToEnd" },
    ];
    const empty = runTextForge("", rules);
    expect(empty.text).toBe("");
    expect(empty.metrics).toEqual({ words: 0, chars: 0, lines: 0, numbers: 0 });

    const input = "b2 a10 ! x1 20";
    const first = runTextForge(input, rules);
    const second = runTextForge(input, rules);
    expect(first).toEqual(second);
  });

  it("transforms text to uppercase", () => {
    const result = runTextForge("Abc 123\ndef", [{ type: "toUppercase" }]);
    expect(result.text).toBe("ABC 123\nDEF");
  });

  it("transforms text to lowercase", () => {
    const result = runTextForge("AbC 123\nDeF", [{ type: "toLowercase" }]);
    expect(result.text).toBe("abc 123\ndef");
  });

  it("transforms text to title case", () => {
    const result = runTextForge("hELLo wORLD\nfoo-bar baz", [{ type: "toTitleCase" }]);
    expect(result.text).toBe("Hello World\nFoo-Bar Baz");
  });

  it("reverses the full text", () => {
    const result = runTextForge("ab 12\ncd", [{ type: "reverseText" }]);
    expect(result.text).toBe("dc\n21 ba");
  });

  it("reverses lines while preserving line contents", () => {
    const result = runTextForge("line1\nline2\nline3", [{ type: "reverseLines" }]);
    expect(result.text).toBe("line3\nline2\nline1");
  });

  it("reverses tokens deterministically", () => {
    const result = runTextForge("alpha beta gamma delta", [{ type: "reverseTokens" }]);
    expect(result.text).toBe("delta gamma beta alpha");
  });

  it("removes empty lines", () => {
    const result = runTextForge("a\n\n\nb\n\nc", [{ type: "removeEmptyLines" }]);
    expect(result.text).toBe("a\nb\nc");
  });

  it("dedupes lines while keeping first occurrence order", () => {
    const result = runTextForge("a\nb\na\nc\nb", [{ type: "dedupeLines" }]);
    expect(result.text).toBe("a\nb\nc");
  });

  it("dedupes tokens while keeping first occurrence order", () => {
    const result = runTextForge("x y x z y x", [{ type: "dedupeTokens" }]);
    expect(result.text).toBe("x y z");
  });

  it("sorts lines by length in asc and desc order", () => {
    const input = "bbbb\ncc\na";
    const asc = runTextForge(input, [{ type: "sortByLength", by: "lines", order: "asc" }]);
    const desc = runTextForge(input, [{ type: "sortByLength", by: "lines", order: "desc" }]);
    expect(asc.text).toBe("a\ncc\nbbbb");
    expect(desc.text).toBe("bbbb\ncc\na");
  });

  it("sorts tokens by length in asc and desc order", () => {
    const input = "bbb ccccc a dd";
    const asc = runTextForge(input, [{ type: "sortByLength", by: "tokens", order: "asc" }]);
    const desc = runTextForge(input, [{ type: "sortByLength", by: "tokens", order: "desc" }]);
    expect(asc.text).toBe("a dd bbb ccccc");
    expect(desc.text).toBe("ccccc bbb dd a");
  });

  it("keeps only numbers", () => {
    const result = runTextForge("ab12 c3! -45", [{ type: "keepOnlyNumbers" }]);
    expect(result.text).toBe("12345");
  });

  it("keeps only letters", () => {
    const result = runTextForge("ab12 c3! -45", [{ type: "keepOnlyLetters" }]);
    expect(result.text).toBe("abc");
  });

  it("keeps only alphanumeric characters", () => {
    const result = runTextForge("ab-12 c3! _Z", [{ type: "keepAlphaNumeric" }]);
    expect(result.text).toBe("ab12c3Z");
  });

  it("removes punctuation while preserving spaces", () => {
    const result = runTextForge("hi, there! a+b=c.", [{ type: "removePunctuation" }]);
    expect(result.text).toBe("hi there abc");
  });

  it("finds and replaces with configurable case sensitivity", () => {
    const insensitive = runTextForge("Foo foo FOO", [
      { type: "findReplace", find: "foo", replaceWith: "bar", caseSensitive: false },
    ]);
    const sensitive = runTextForge("Foo foo FOO", [
      { type: "findReplace", find: "foo", replaceWith: "bar", caseSensitive: true },
    ]);
    expect(insensitive.text).toBe("bar bar bar");
    expect(sensitive.text).toBe("Foo bar FOO");
  });

  it("regex replace substitutes all matches and supports captures", () => {
    expect(
      runTextForge("foo123bar", [{ type: "regexReplace", pattern: "(\\d+)", replacement: "[$1]", flags: "g" }]).text,
    ).toBe("foo[123]bar");
    expect(runTextForge("a a a", [{ type: "regexReplace", pattern: "a", replacement: "b", flags: "" }]).text).toBe(
      "b b b",
    );
    expect(
      runTextForge("Hello", [{ type: "regexReplace", pattern: "hello", replacement: "Hi", flags: "gi" }]).text,
    ).toBe("Hi");
  });

  it("regex replace is a no-op for empty or invalid pattern", () => {
    const input = "abc";
    expect(runTextForge(input, [{ type: "regexReplace", pattern: "", replacement: "x", flags: "g" }]).text).toBe(
      input,
    );
    expect(
      runTextForge(input, [{ type: "regexReplace", pattern: "(unclosed", replacement: "x", flags: "g" }]).text,
    ).toBe(input);
  });

  it("adds prefix and suffix to each line", () => {
    const result = runTextForge("a\nb", [{ type: "addPrefixSuffixLines", prefix: "[", suffix: "]" }]);
    expect(result.text).toBe("[a]\n[b]");
  });

  it("wraps lines with prefix and suffix", () => {
    const result = runTextForge("x\ny", [{ type: "wrapLines", prefix: "<", suffix: ">" }]);
    expect(result.text).toBe("<x>\n<y>");
  });

  it("adds deterministic line numbering with custom start", () => {
    const result = runTextForge("alpha\nbeta\ngamma", [{ type: "lineNumbering", startAt: 3 }]);
    expect(result.text).toBe("3. alpha\n4. beta\n5. gamma");
  });

  it("normalizes mixed newlines to unix style", () => {
    const result = runTextForge("one\r\ntwo\rthree\nfour", [{ type: "normalizeNewlines" }]);
    expect(result.text).toBe("one\ntwo\nthree\nfour");
  });

  it("slugifies text to URL-safe output", () => {
    const result = runTextForge(" Hello, World! SIP Analyzer 2026 ", [{ type: "slugify" }]);
    expect(result.text).toBe("hello-world-sip-analyzer-2026");
  });

  it("extracts email addresses line-by-line", () => {
    const input = "Primary: a@example.com backup: b+tag@test.org; invalid@ local";
    const result = runTextForge(input, [{ type: "extractEmails" }]);
    expect(result.text).toBe("a@example.com\nb+tag@test.org");
  });

  it("extracts urls line-by-line", () => {
    const input = "Visit https://example.com/a?x=1 and http://test.org/docs.";
    const result = runTextForge(input, [{ type: "extractUrls" }]);
    expect(result.text).toBe("https://example.com/a?x=1\nhttp://test.org/docs");
  });

  it("encodes and decodes url components", () => {
    const encoded = runTextForge("hello world/+", [{ type: "urlEncode" }]);
    const decoded = runTextForge(encoded.text, [{ type: "urlDecode" }]);
    expect(encoded.text).toBe("hello%20world%2F%2B");
    expect(decoded.text).toBe("hello world/+");
  });

  it("encodes and decodes base64", () => {
    const encoded = runTextForge("alpha beta", [{ type: "base64Encode" }]);
    const decoded = runTextForge(encoded.text, [{ type: "base64Decode" }]);
    expect(encoded.text).toBe("YWxwaGEgYmV0YQ==");
    expect(decoded.text).toBe("alpha beta");
  });

  it("trims whitespace on each line while preserving line structure", () => {
    const result = runTextForge("  alpha  \n\t beta\t\n   ", [{ type: "trimLines" }]);
    expect(result.text).toBe("alpha\nbeta\n");
  });

  it("collapses blank lines using default max consecutive value", () => {
    const result = runTextForge("a\n\n\n\nb\n\n\nc", [{ type: "collapseBlankLines" }]);
    expect(result.text).toBe("a\n\nb\n\nc");
  });

  it("collapses blank lines with custom max consecutive value", () => {
    const result = runTextForge("a\n\n\n\nb\n\n\n\n\nc", [{ type: "collapseBlankLines", maxConsecutive: 2 }]);
    expect(result.text).toBe("a\n\n\nb\n\n\nc");
  });

  it("removes non-ascii characters deterministically", () => {
    const result = runTextForge("Cafe 😀\nnaive—test", [{ type: "removeNonAscii" }]);
    expect(result.text).toBe("Cafe \nnaivetest");
  });

  it("removes duplicate characters while preserving first occurrence order", () => {
    const result = runTextForge("balloon 1122", [{ type: "removeDuplicateCharacters" }]);
    expect(result.text).toBe("balon 12");
  });

  it("escapes and unescapes html entities", () => {
    const escaped = runTextForge(`<div class="x">Tom & Jerry's</div>`, [{ type: "htmlEscape" }]);
    const unescaped = runTextForge(escaped.text, [{ type: "htmlUnescape" }]);
    expect(escaped.text).toBe("&lt;div class=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/div&gt;");
    expect(unescaped.text).toBe(`<div class="x">Tom & Jerry's</div>`);
  });

  it("converts csv to lines and handles simple quoted values", () => {
    const result = runTextForge(`alpha,"beta,gamma","escaped ""quote"""`, [{ type: "csvToLines" }]);
    expect(result.text).toBe('alpha\nbeta,gamma\nescaped "quote"');
  });

  it("converts lines to csv with safe quoting", () => {
    const result = runTextForge(`alpha\nbeta,gamma\nsaid "hello"`, [{ type: "linesToCsv" }]);
    expect(result.text).toBe('alpha,"beta,gamma","said ""hello"""');
  });

  it("sorts ipv4 addresses numerically in ascending and descending order", () => {
    const input = "10.0.0.2\n2.2.2.2\nbad.ip\n10.0.0.10";
    const asc = runTextForge(input, [{ type: "sortIpAddresses", order: "asc" }]);
    const desc = runTextForge(input, [{ type: "sortIpAddresses", order: "desc" }]);
    expect(asc.text).toBe("2.2.2.2\n10.0.0.2\n10.0.0.10\nbad.ip");
    expect(desc.text).toBe("10.0.0.10\n10.0.0.2\n2.2.2.2\nbad.ip");
  });

  it("extracts signed and decimal numbers line-by-line", () => {
    const result = runTextForge("A-10 B3.5 C +4 D0.25", [{ type: "extractNumbers" }]);
    expect(result.text).toBe("-10\n3.5\n4\n0.25");
  });

  it("removes diacritics while preserving base characters", () => {
    const result = runTextForge("Crème brûlée déjà vu", [{ type: "removeDiacritics" }]);
    expect(result.text).toBe("Creme brulee deja vu");
  });

  it("pads lines on left and right with configured width and fill character", () => {
    const left = runTextForge("a\nabcd", [{ type: "padLines", direction: "left", width: 4, char: "0" }]);
    const right = runTextForge("a\nabcd", [{ type: "padLines", direction: "right", width: 4, char: "." }]);
    expect(left.text).toBe("000a\nabcd");
    expect(right.text).toBe("a...\nabcd");
  });
});
