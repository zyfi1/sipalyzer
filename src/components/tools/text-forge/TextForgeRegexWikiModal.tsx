import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookOpen } from "@/lib/icons";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function TryThisExample({
  title,
  why,
  before,
  after,
  pattern,
  replacement,
  flags,
}: {
  title: string;
  why: string;
  before: string;
  after: string;
  pattern: string;
  replacement: string;
  flags: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-gradient-to-b from-primary/[0.06] via-transparent to-transparent",
        "p-3.5 shadow-[0_1px_0_0_hsl(var(--border)/0.35)]",
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-xs font-semibold text-foreground tracking-tight">{title}</p>
          <p className="text-2xs text-muted-foreground mt-0.5 leading-snug">{why}</p>
        </div>
        <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
          Example
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg border border-border/40 bg-background/60 px-2.5 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Before</span>
          <pre className="mt-1 text-2xs font-mono text-foreground whitespace-pre-wrap break-all leading-relaxed">
            {before}
          </pre>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/[0.04] px-2.5 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-primary/90">After</span>
          <pre className="mt-1 text-2xs font-mono text-foreground whitespace-pre-wrap break-all leading-relaxed">
            {after}
          </pre>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-2xs">
        <div className="rounded-lg border border-border/35 bg-background/50 px-2 py-1.5">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">
            Pattern
          </span>
          <code className="font-mono text-foreground break-all">{pattern}</code>
        </div>
        <div className="rounded-lg border border-border/35 bg-background/50 px-2 py-1.5">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">
            Replace with
          </span>
          <code className="font-mono text-foreground break-all">{replacement || "(empty)"}</code>
        </div>
        <div className="rounded-lg border border-border/35 bg-background/50 px-2 py-1.5">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">
            Flags
          </span>
          <code className="font-mono text-foreground">{flags}</code>
        </div>
      </div>
    </div>
  );
}

function WikiSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/45 bg-card/40 p-4 sm:p-5",
        "shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.04)]",
      )}
    >
      <div className="mb-3 sm:mb-4">
        <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
        {subtitle ? <p className="text-2xs text-muted-foreground mt-1 leading-relaxed max-w-prose">{subtitle}</p> : null}
      </div>
      <div className="text-xs text-muted-foreground leading-relaxed space-y-3 [&_code]:rounded-md [&_code]:bg-muted/70 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.7rem] [&_code]:text-foreground/90">
        {children}
      </div>
    </section>
  );
}

function WikiTable({ rows }: { rows: Array<{ pattern: string; meaning: string; tip?: string }> }) {
  return (
    <div className="rounded-lg border border-border/40 overflow-hidden text-2xs">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-muted/50 text-left border-b border-border/40">
            <th className="px-3 py-2 font-semibold text-foreground/80 w-[min(34%,11rem)]">Write this</th>
            <th className="px-3 py-2 font-semibold text-foreground/80">What it does</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={`${row.pattern}-${i}`}
              className="border-b border-border/25 last:border-0 hover:bg-muted/20 transition-colors"
            >
              <td className="px-3 py-2.5 font-mono text-xs text-foreground align-top">{row.pattern}</td>
              <td className="px-3 py-2.5 align-top">
                <span className="text-muted-foreground">{row.meaning}</span>
                {row.tip ? (
                  <span className="block mt-1 text-[10px] text-muted-foreground/85 italic">{row.tip}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const QUICK_EXAMPLES = [
  {
    title: "Turn digits into tagged values",
    why: "Wrap every number so it stands out—great for logs or CSVs.",
    before: "order 42 shipped",
    after: "order [42] shipped",
    pattern: String.raw`(\d+)`,
    replacement: "[$1]",
    flags: "g",
  },
  {
    title: "Normalize spaces",
    why: "Replace tabs or double spaces with a single space.",
    before: "hello    world\t!",
    after: "hello world !",
    pattern: String.raw`\s+`,
    replacement: " ",
    flags: "g",
  },
  {
    title: "Remove trailing spaces on each line",
    why: "Use multiline mode so $ means end of line, not only end of file.",
    before: "line one  \nline two   ",
    after: "line one\nline two",
    pattern: String.raw`[ \t]+$`,
    replacement: "",
    flags: "gm",
  },
  {
    title: "Insert a prefix before words",
    why: "Capture the word and put static text in front with $1.",
    before: "foo bar",
    after: "id:foo id:bar",
    pattern: String.raw`\b(\w+)\b`,
    replacement: "id:$1",
    flags: "g",
  },
] as const;

export function TextForgeRegexWikiModal({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[min(92vh,940px)] w-full gap-0 overflow-hidden p-0",
          "max-w-[calc(100vw-1rem)] sm:max-w-[min(56rem,calc(100vw-1.5rem))]",
          "border-border/55 shadow-2xl shadow-black/20",
        )}
        showCloseButton
      >
        <DialogHeader
          className={cn(
            "relative px-6 sm:px-8 pt-6 sm:pt-7 pb-5 text-left shrink-0 overflow-hidden",
            "border-b border-border/40 bg-gradient-to-br from-muted/35 via-card to-card",
          )}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary/70 via-primary/40 to-primary/20 rounded-none"
            aria-hidden
          />
          <div className="flex items-center gap-2.5 pl-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary border border-primary/20">
              <BookOpen className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <DialogTitle className="text-lg sm:text-xl font-semibold tracking-tight text-foreground pr-8">
                Regex guide
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-left text-muted-foreground mt-1 max-w-2xl leading-relaxed">
                Friendly reference for <strong className="text-foreground font-medium">Regex replace</strong> in Text
                Forge. Same rules as JavaScript in your browser—use the examples below, then tweak for your text.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto px-4 sm:px-8 py-5 sm:py-6 space-y-5 sm:space-y-6 max-h-[min(74vh,760px)] bg-gradient-to-b from-background via-background to-muted/15">
          <section className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 px-0.5">
              <div>
                <h2 className="text-sm font-semibold text-foreground tracking-tight">Start here — real examples</h2>
                <p className="text-2xs text-muted-foreground mt-0.5 max-w-xl leading-relaxed">
                  Each card shows input and output. Use the same pattern, replacement, and flags in your pipeline step.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2">
              {QUICK_EXAMPLES.map((ex) => (
                <TryThisExample key={ex.title} {...ex} />
              ))}
            </div>
          </section>

          <WikiSection
            title="How this step works"
            subtitle="In plain terms: you give a search pattern and a replacement. Every match is updated in one pass."
          >
            <ul className="list-disc pl-4 space-y-1.5 text-muted-foreground">
              <li>
                Leave <strong className="text-foreground font-medium">Pattern</strong> empty and nothing changes—safe
                while you are experimenting.
              </li>
              <li>
                Text Forge always ensures a <strong className="text-foreground font-medium">global</strong> search (
                <code>g</code>) so all matches are replaced, not just the first one.
              </li>
              <li>
                If the pattern is invalid, your text is left as-is—fix the typo and run again.
              </li>
            </ul>
          </WikiSection>

          <WikiSection
            title="Character classes"
            subtitle="Shorthand for “match this kind of character.”"
          >
            <WikiTable
              rows={[
                { pattern: ".", meaning: "Any single character (except newlines unless you use the s flag)." },
                { pattern: String.raw`\d  \w  \s`, meaning: "Digit · word character (letters, digits, _) · whitespace." },
                { pattern: String.raw`\D  \W  \S`, meaning: "The opposite: not digit, not word char, not whitespace." },
                { pattern: "[aeiou]", meaning: "One vowel from the list." },
                { pattern: "[^0-9]", meaning: "Anything that is not a digit.", tip: "^ inside [] means “not”." },
                { pattern: "[a-z]", meaning: "Any lowercase letter, a through z." },
              ]}
            />
          </WikiSection>

          <WikiSection
            title="Anchors & word boundaries"
            subtitle="Pin a match to the start, end, or edge of a word."
          >
            <WikiTable
              rows={[
                {
                  pattern: "^",
                  meaning: "Start of the whole string—or start of each line if you add the m flag.",
                  tip: "Example: ^#  with flags gm removes # only at line start.",
                },
                { pattern: "$", meaning: "End of string, or end of each line with m." },
                { pattern: String.raw`\b`, meaning: "Word boundary: between a “word” character and something else." },
                { pattern: String.raw`\B`, meaning: "Not at a word boundary." },
              ]}
            />
          </WikiSection>

          <WikiSection
            title="Repeats & optional parts"
            subtitle="Control how many times the thing before can appear."
          >
            <WikiTable
              rows={[
                { pattern: "a?", meaning: "Zero or one a." },
                { pattern: "a*", meaning: "Zero or more a’s." },
                { pattern: "a+", meaning: "One or more a’s." },
                { pattern: "a{3}", meaning: "Exactly three a’s in a row." },
                { pattern: "a{2,5}", meaning: "Between two and five a’s." },
                {
                  pattern: "a+?",
                  meaning: "Lazy (non-greedy): as few characters as possible.",
                  tip: "Same idea for *? and ?? — handy for short matches inside long lines.",
                },
              ]}
            />
          </WikiSection>

          <WikiSection
            title="Groups & either/or"
            subtitle="Remember part of the match and reuse it in the replacement with $1, $2, …"
          >
            <WikiTable
              rows={[
                { pattern: "(foo)", meaning: "Capturing group #1 — use $1 in the replacement box." },
                { pattern: "(?:foo)", meaning: "Group without capturing — for organizing the pattern only." },
                { pattern: "cat|dog", meaning: "Match cat or dog." },
              ]}
            />
          </WikiSection>

          <WikiSection
            title="Lookaround (advanced)"
            subtitle="Peek ahead or behind without including that peek in the match. Supported in modern browsers."
          >
            <p>
              Examples: <code>(?=...)</code> must be followed by …, <code>(?!...)</code> must not be followed by ….
              Lookbehind uses <code>(?&lt;=...)</code> and <code>(?&lt;!...)</code>. These shine when you need a very
              specific context without changing surrounding text in one go.
            </p>
          </WikiSection>

          <WikiSection
            title="Flags cheat sheet"
            subtitle="Type these in the Flags field. Invalid letters are ignored; g is added for you if missing."
          >
            <WikiTable
              rows={[
                { pattern: "g", meaning: "Global — replace every match (always on in practice here)." },
                { pattern: "i", meaning: "Ignore case: A matches a." },
                { pattern: "m", meaning: "Multiline: ^ and $ work per line." },
                { pattern: "s", meaning: "Dot matches newline too." },
                { pattern: "u", meaning: "Unicode-aware matching." },
              ]}
            />
          </WikiSection>

          <WikiSection
            title="Replacement magic"
            subtitle="Special codes in the replacement string (JavaScript rules)."
          >
            <WikiTable
              rows={[
                { pattern: "$&", meaning: "The full text that matched." },
                { pattern: "$1  $2", meaning: "What group 1 or 2 captured in parentheses." },
                { pattern: "$`", meaning: "Everything in the string before this match." },
                { pattern: "$'", meaning: "Everything after this match." },
                { pattern: "$$", meaning: "A literal dollar sign." },
              ]}
            />
          </WikiSection>

          <WikiSection
            title="When . * + ? need a backslash"
            subtitle="These are special unless you escape them to mean the literal character."
          >
            <p>
              Characters like <code>. * + ? ^ $ ( ) [ ] {"{ }"} | \\</code> often need <code>\</code> in front when you
              want the literal symbol—for example <code>\.</code> for a real dot in an IP or version number.
            </p>
          </WikiSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
