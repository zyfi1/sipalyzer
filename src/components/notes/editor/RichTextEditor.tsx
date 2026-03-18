import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Undo,
  Redo,
  Eye,
  EyeOff,
  Minus,
  Square,
  RemoveFormatting,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useState, useCallback, useEffect } from "react";
import { MarkdownRenderer } from "@/components/notes/MarkdownRenderer";

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  className?: string;
  showPreview?: boolean;
  onPreviewToggle?: (show: boolean) => void;
  /** Focus the editor on mount (e.g. for new notes) */
  autoFocus?: boolean;
}

const lowlight = createLowlight(common);

/** Toolbar button: use onMouseDown preventDefault so the editor keeps focus; run command in rAF so it runs after focus */
function ToolbarButton({
  onAction,
  isActive,
  children,
  title,
  disabled,
}: {
  onAction: () => void;
  isActive?: boolean;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    requestAnimationFrame(() => onAction());
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("h-8 w-8 p-0 shrink-0", isActive && "bg-muted text-foreground")}
      onMouseDown={handleMouseDown}
      title={title}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

export function RichTextEditor({
  content,
  onChange,
  className,
  showPreview: controlledPreview,
  onPreviewToggle,
  autoFocus = false,
}: RichTextEditorProps) {
  const [internalPreview, setInternalPreview] = useState(false);
  const showPreview = controlledPreview !== undefined ? controlledPreview : internalPreview;
  const setShowPreview = onPreviewToggle || setInternalPreview;

  const syncMarkdown = useCallback(
    (editor: NonNullable<ReturnType<typeof useEditor>>) => {
      if (!editor) return;
      try {
        const ed = editor as { getMarkdown?: () => string; storage?: { markdown?: { getMarkdown?: () => string } }; getHTML: () => string };
        if (typeof ed.getMarkdown === "function") {
          const markdown = ed.getMarkdown();
          onChange(markdown ?? "");
          return;
        }
        const markdownStorage = ed.storage?.markdown;
        if (markdownStorage && typeof markdownStorage.getMarkdown === "function") {
          const markdown = markdownStorage.getMarkdown();
          onChange(markdown ?? "");
          return;
        }
        onChange(ed.getHTML());
      } catch {
        onChange(content);
      }
    },
    [onChange, content]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Markdown,
    ],
    content: content ?? "",
    contentType: "markdown",
    editable: true,
    onUpdate: ({ editor: ed }) => {
      syncMarkdown(ed);
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[200px] px-4 py-3 outline-none",
      },
    },
  });

  useEffect(() => {
    if (autoFocus && editor && !showPreview) {
      editor.commands.focus("end");
    }
  }, [autoFocus, editor, showPreview]);

  if (!editor) {
    return null;
  }

  return (
    <div className={cn("flex flex-col border border-border rounded-md bg-background", className)}>
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30 flex-wrap">
        {/* Text formatting */}
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          title="Strikethrough"
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive("code")}
          title="Inline code"
        >
          <Code className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onAction={() => editor.chain().focus().unsetAllMarks().run()}
          title="Clear formatting"
        >
          <RemoveFormatting className="h-4 w-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-border mx-1 shrink-0" aria-hidden />

        {/* Headings */}
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive("heading", { level: 1 })}
          title="Heading 1"
        >
          <Heading1 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
        >
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive("heading", { level: 3 })}
          title="Heading 3"
        >
          <Heading3 className="h-4 w-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-border mx-1 shrink-0" aria-hidden />

        {/* Lists & blockquote */}
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          title="Numbered list"
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          title="Quote"
        >
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-border mx-1 shrink-0" aria-hidden />

        {/* Code block & horizontal rule */}
        <ToolbarButton
          onAction={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive("codeBlock")}
          title="Code block"
        >
          <Square className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onAction={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal rule"
        >
          <Minus className="h-4 w-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-border mx-1 shrink-0" aria-hidden />

        {/* Undo / Redo */}
        <ToolbarButton
          onAction={() => editor.chain().focus().undo().run()}
          title="Undo (Ctrl+Z)"
          disabled={!editor.can().undo()}
        >
          <Undo className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onAction={() => editor.chain().focus().redo().run()}
          title="Redo (Ctrl+Shift+Z)"
          disabled={!editor.can().redo()}
        >
          <Redo className="h-4 w-4" />
        </ToolbarButton>
        <div className="flex-1 min-w-2" aria-hidden />

        {/* Preview */}
        <ToolbarButton
          onAction={() => setShowPreview(!showPreview)}
          isActive={showPreview}
          title="Toggle preview"
        >
          {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </ToolbarButton>
      </div>

      {showPreview ? (
        <div className="flex-1 overflow-y-auto p-4">
          <MarkdownRenderer content={content} className="prose prose-sm" useNotesStyles={false} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-[200px]" data-editor-wrapper>
          <EditorContent editor={editor} className="min-h-[200px]" />
        </div>
      )}
    </div>
  );
}
