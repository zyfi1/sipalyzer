import TurndownService from "turndown";
import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: false,
});

// Configure Turndown for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
  strongDelimiter: "**",
  linkStyle: "inlined",
});

// Add support for strikethrough
turndownService.addRule("strikethrough", {
  filter: ["del", "s"] as (keyof HTMLElementTagNameMap)[],
  replacement: (content) => `~~${content}~~`,
});

// Add support for task lists
turndownService.addRule("taskListItem", {
  filter: (node) => {
    return (
      node.nodeName === "LI" &&
      node.parentNode?.nodeName === "UL" &&
      node.getAttribute("data-type") === "taskItem"
    );
  },
  replacement: (content, node) => {
    const checkbox = (node as HTMLElement).querySelector('input[type="checkbox"]');
    const checked = checkbox?.getAttribute("checked") !== null;
    const cleanContent = content.replace(/^\s*\[[ x]\]\s*/, "").trim();
    return `- [${checked ? "x" : " "}] ${cleanContent}\n`;
  },
});

// Add support for highlighted text
turndownService.addRule("highlight", {
  filter: ["mark"],
  replacement: (content) => `==${content}==`,
});

// Add support for tables
turndownService.addRule("tableCell", {
  filter: ["th", "td"],
  replacement: (content) => {
    return ` ${content.trim()} |`;
  },
});

turndownService.addRule("tableRow", {
  filter: "tr",
  replacement: (content, node) => {
    const cells = content.trim();
    const isHeader = (node as HTMLElement).parentNode?.nodeName === "THEAD";
    let row = `|${cells}\n`;
    
    if (isHeader) {
      const cellCount = (node as HTMLElement).querySelectorAll("th, td").length;
      const separator = `|${Array(cellCount).fill(" --- ").join("|")}|\n`;
      row += separator;
    }
    
    return row;
  },
});

turndownService.addRule("table", {
  filter: "table",
  replacement: (content) => {
    return `\n${content}\n`;
  },
});

// Keep certain elements as-is
turndownService.keep(["sup", "sub"]);

/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html === "<p></p>") return "";
  
  try {
    const markdown = turndownService.turndown(html);
    return markdown.trim();
  } catch (error) {
    console.error("Error converting HTML to Markdown:", error);
    return html;
  }
}

/**
 * Convert Markdown to HTML for TipTap
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return "";
  
  try {
    const html = marked.parse(markdown, { async: false }) as string;
    return html;
  } catch (error) {
    console.error("Error converting Markdown to HTML:", error);
    return `<p>${markdown}</p>`;
  }
}

/**
 * Extract plain text from HTML
 */
export function htmlToPlainText(html: string): string {
  const temp = document.createElement("div");
  temp.innerHTML = html;
  return temp.textContent || temp.innerText || "";
}

/**
 * Get a preview/excerpt from markdown content
 */
export function getMarkdownExcerpt(markdown: string, maxLength: number = 150): string {
  // Remove markdown formatting for preview
  const plain = markdown
    .replace(/#{1,6}\s+/g, "") // headings
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/__([^_]+)__/g, "$1") // bold alt
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/_([^_]+)_/g, "$1") // italic alt
    .replace(/~~([^~]+)~~/g, "$1") // strikethrough
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/```[\s\S]*?```/g, "[code block]") // code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "[image]") // images
    .replace(/^[-*+]\s+/gm, "") // list items
    .replace(/^\d+\.\s+/gm, "") // ordered list items
    .replace(/^>\s+/gm, "") // blockquotes
    .replace(/\n+/g, " ") // newlines to spaces
    .trim();
  
  if (plain.length <= maxLength) return plain;
  return plain.substring(0, maxLength).trim() + "...";
}
