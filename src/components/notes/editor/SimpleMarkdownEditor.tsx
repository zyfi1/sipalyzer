import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Bold,
  Italic,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Square,
  Eye,
  EyeOff,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import { MarkdownRenderer } from "../MarkdownRenderer";

interface SimpleMarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

function insertAround(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string = before
): { value: string; newCursor: number } {
  const selected = text.slice(start, end);
  const newValue = text.slice(0, start) + before + selected + after + text.slice(end);
  // When no selection: put cursor in the middle so typed text is wrapped correctly
  const newCursor =
    start === end
      ? start + before.length
      : start + before.length + selected.length + after.length;
  return { value: newValue, newCursor };
}

function insertAtLineStart(
  text: string,
  start: number,
  prefix: string,
  stripRegex?: RegExp
): { value: string; newCursor: number } {
  const before = text.slice(0, start);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = text.indexOf("\n", lineStart);
  const lineEndOr = lineEnd === -1 ? text.length : lineEnd;
  let lineContent = text.slice(lineStart, lineEndOr);
  let stripped = 0;
  if (stripRegex) {
    const m = lineContent.match(stripRegex);
    if (m) {
      stripped = m[0].length;
      lineContent = lineContent.slice(stripped);
    }
  }
  const newValue = text.slice(0, lineStart) + prefix + lineContent + text.slice(lineEndOr);
  const newCursor = start + prefix.length - stripped;
  return { value: newValue, newCursor };
}

export function SimpleMarkdownEditor({
  content,
  onChange,
  className,
  placeholder = "Write your note in Markdown…",
  autoFocus = false,
}: SimpleMarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(content.length, content.length);
    }
  }, [autoFocus, content.length]);

  // Apply pending cursor/selection after React has committed the new content (fixes cursor jumping on re-render)
  useEffect(() => {
    if (showPreview || pendingSelectionRef.current == null) return;
    const { start, end } = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      const len = el.value.length;
      const safeStart = Math.max(0, Math.min(start, len));
      const safeEnd = Math.max(safeStart, Math.min(end, len));
      el.setSelectionRange(safeStart, safeEnd);
    }
  }, [content, showPreview]);

  const getSelection = () => {
    const el = textareaRef.current;
    if (!el) return { start: 0, end: 0, value: content };
    return { start: el.selectionStart, end: el.selectionEnd, value: content };
  };

  const apply = (result: { value: string; newCursor: number }) => {
    pendingSelectionRef.current = { start: result.newCursor, end: result.newCursor };
    onChange(result.value);
  };

  const wrap = (before: string, after: string = before) => {
    const { start, end, value } = getSelection();
    apply(insertAround(value, start, end, before, after));
  };

  const linePrefix = (prefix: string, stripRegex?: RegExp) => {
    const { start, value } = getSelection();
    apply(insertAtLineStart(value, start, prefix, stripRegex));
  };

  const blockWrap = (before: string, after: string) => {
    const { start, end, value } = getSelection();
    const sel = value.slice(start, end);
    const newVal =
      value.slice(0, start) +
      (sel ? before + "\n" + sel + "\n" + after : before + "\n\n" + after) +
      value.slice(end);
    const newCursor = sel
      ? start + before.length + 1 + sel.length + 1 + after.length
      : start + before.length + 1;
    pendingSelectionRef.current = { start: newCursor, end: newCursor };
    onChange(newVal);
  };

  const insertAtCursor = (insert: string) => {
    const { start, value } = getSelection();
    const newVal = value.slice(0, start) + insert + value.slice(start);
    const newCursor = start + insert.length;
    pendingSelectionRef.current = { start: newCursor, end: newCursor };
    onChange(newVal);
  };

  const ToolbarBtn = ({
    onClick,
    title,
    children,
    active,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
    active?: boolean;
  }) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("h-8 w-8 p-0 shrink-0", active && "bg-muted")}
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        textareaRef.current?.focus();
      }}
      onClick={onClick}
    >
      {children}
    </Button>
  );

  return (
    <div className={cn("flex flex-col border border-border rounded-md bg-background overflow-hidden", className)}>
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted flex-wrap">
        <ToolbarBtn onClick={() => wrap("**", "**")} title="Bold">
          <Bold className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => wrap("_", "_")} title="Italic">
          <Italic className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => wrap("`", "`")} title="Inline code">
          <Code className="h-4 w-4" />
        </ToolbarBtn>
        <AppDivider orientation="vertical" size="lg" className="mx-1" />
        <ToolbarBtn onClick={() => linePrefix("# ", /^#+\s*/)} title="Heading 1">
          <Heading1 className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => linePrefix("## ", /^#+\s*/)} title="Heading 2">
          <Heading2 className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => linePrefix("### ", /^#+\s*/)} title="Heading 3">
          <Heading3 className="h-4 w-4" />
        </ToolbarBtn>
        <AppDivider orientation="vertical" size="lg" className="mx-1" />
        <ToolbarBtn onClick={() => linePrefix("- ", /^[-*]\s/)} title="Bullet list">
          <List className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => linePrefix("1. ", /^\d+\.\s/)} title="Numbered list">
          <ListOrdered className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => linePrefix("> ", /^>\s/)} title="Quote">
          <Quote className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => blockWrap("```", "```")} title="Code block">
          <Square className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => insertAtCursor("\n\n---\n\n")} title="Horizontal rule">
          <Minus className="h-4 w-4" />
        </ToolbarBtn>
        <div className="flex-1 min-w-2" />
        <ToolbarBtn
          onClick={() => {
            setShowPreview((p) => !p);
            pendingSelectionRef.current = null;
          }}
          title="Toggle preview"
          active={showPreview}
        >
          {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </ToolbarBtn>
      </div>

      {showPreview ? (
        <div className="flex-1 overflow-y-auto p-4 min-h-[200px]">
          <MarkdownRenderer content={content} />
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            const el = e.target;
            pendingSelectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
            onChange(el.value);
          }}
          placeholder={placeholder}
          className="flex-1 min-h-[240px] resize-none border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm"
          spellCheck={true}
        />
      )}
    </div>
  );
}
