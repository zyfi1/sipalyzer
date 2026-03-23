import { memo, type MouseEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
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
  Minus,
  Table,
  Image,
  LinkIcon,
  Undo,
  Redo,
  RemoveFormatting,
  CheckSquare,
  Sparkles,
  Terminal,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { AppDivider } from "@/components/ui/panel-chrome";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "@/lib/icons";
import { useEditorState } from "@tiptap/react";

interface EditorToolbarProps {
  editor: Editor;
  onAddLink: () => void;
  onAddImage: () => void;
  onInsertTable: () => void;
  preset?: "full" | "simple";
}

/**
 * Prevent mousedown from stealing focus away from the editor.
 * This is critical — without it, clicking a toolbar button blurs the editor
 * selection, so marks like inline code, bold, italic, etc. can't be toggled.
 */
function preventFocusLoss(e: MouseEvent) {
  e.preventDefault();
}

function ToolbarButton({
  onClick,
  isActive,
  disabled,
  title,
  description,
  children,
}: {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const btn = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-6.5 w-6.5 p-0 shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent/55 transition-colors",
        isActive && "bg-primary/15 text-foreground ring-1 ring-primary/35"
      )}
      onMouseDown={preventFocusLoss}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
  return (
    <TooltipWrapper title={title} description={description ?? undefined}>
      {btn}
    </TooltipWrapper>
  );
}

function Separator() {
  return <AppDivider orientation="vertical" size="sm" className="mx-0.5" />;
}

export const EditorToolbar = memo(function EditorToolbar({
  editor,
  onAddLink,
  onAddImage,
  onInsertTable,
  preset = "full",
}: EditorToolbarProps) {
  // Subscribe to only the editor state bits we need for active states.
  // This avoids re-rendering the toolbar on every single keystroke.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }: { editor: Editor }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      paragraph: e.isActive("paragraph"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      blockquote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  return (
    <div className="notes-editor-toolbar ui-sticky-header z-20 flex items-center gap-0.5 px-2 py-1 flex-nowrap overflow-x-auto">
      <div className="notes-toolbar-segment">
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!state.canUndo}
          title="Undo"
          description="Undo last change (Ctrl+Z)."
        >
          <Undo className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!state.canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo className="h-4 w-4" />
        </ToolbarButton>
      </div>

      <div className="notes-toolbar-segment">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={state.bold}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={state.italic}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        {preset === "full" && (
          <>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={state.strike}
              title="Strikethrough"
            >
              <Strikethrough className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleCode().run()}
              isActive={state.code}
              title="Inline Code (Ctrl+E)"
            >
              <Code className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleHighlight().run()}
              isActive={state.highlight}
              title="Highlight"
            >
              <Sparkles className="h-4 w-4" />
            </ToolbarButton>
          </>
        )}
      </div>

      <div className="notes-toolbar-segment">
        {preset === "full" && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <TooltipWrapper content="Headings">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-6.5 gap-1 px-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/55",
                      (state.h1 || state.h2 || state.h3) && "bg-primary/15 text-foreground ring-1 ring-primary/35"
                    )}
                    onMouseDown={preventFocusLoss}
                  >
                    <Heading1 className="h-4 w-4" />
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </TooltipWrapper>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onMouseDown={preventFocusLoss}
                  onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                  className={cn(state.h1 && "bg-primary/10 text-primary")}
                >
                  <Heading1 className="h-4 w-4 mr-2" />
                  Heading 1
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={preventFocusLoss}
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  className={cn(state.h2 && "bg-primary/10 text-primary")}
                >
                  <Heading2 className="h-4 w-4 mr-2" />
                  Heading 2
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={preventFocusLoss}
                  onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                  className={cn(state.h3 && "bg-primary/10 text-primary")}
                >
                  <Heading3 className="h-4 w-4 mr-2" />
                  Heading 3
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={preventFocusLoss}
                  onClick={() => editor.chain().focus().setParagraph().run()}
                  className={cn(state.paragraph && "bg-primary/10 text-primary")}
                >
                  Normal text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Separator />
          </>
        )}

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={state.bulletList}
          title="Bullet List"
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={state.orderedList}
          title="Numbered List"
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        {preset === "full" && (
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            isActive={state.taskList}
            title="Task List"
          >
            <CheckSquare className="h-4 w-4" />
          </ToolbarButton>
        )}
      </div>

      {preset === "full" && (
        <div className="notes-toolbar-segment">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={state.blockquote}
            title="Quote"
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            isActive={state.codeBlock}
            title="Code Block"
          >
            <Terminal className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal Rule"
          >
            <Minus className="h-4 w-4" />
          </ToolbarButton>
          <Separator />
          <ToolbarButton onClick={onAddLink} isActive={state.link} title="Add Link">
            <LinkIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={onAddImage} title="Add Image">
            <Image className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={onInsertTable} isActive={state.table} title="Insert Table">
            <Table className="h-4 w-4" />
          </ToolbarButton>
        </div>
      )}

      <div className="flex-1 min-w-2" />

      <div className="notes-toolbar-segment">
        <ToolbarButton
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          title="Clear Formatting"
        >
          <RemoveFormatting className="h-4 w-4" />
        </ToolbarButton>
      </div>
    </div>
  );
});
