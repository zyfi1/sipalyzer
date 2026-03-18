import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import { common, createLowlight } from "lowlight";
import { useEffect, useCallback, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { cn } from "@/lib/utils";
import { EditorToolbar } from "./EditorToolbar";
import { htmlToMarkdown, markdownToHtml } from "./markdownUtils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const lowlight = createLowlight(common);

interface TipTapEditorProps {
  content: string;
  onChange: (content: string) => void;
  onHtmlChange?: (html: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  editable?: boolean;
  toolbarPreset?: "full" | "simple";
}

export function TipTapEditor({
  content,
  onChange,
  onHtmlChange,
  className,
  placeholder = "Start writing your note...",
  autoFocus = false,
  editable = true,
  toolbarPreset = "full",
}: TipTapEditorProps) {
  // Track whether the last change came from inside the editor (user typing)
  // to avoid a lossy roundtrip: HTML -> Markdown -> HTML that fights the editor.
  const isInternalChange = useRef(false);
  // Keep latest onChange in a ref so the TipTap onUpdate closure always calls
  // the current callback without needing to recreate the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onHtmlChangeRef = useRef(onHtmlChange);
  onHtmlChangeRef.current = onHtmlChange;
  // Track the last markdown we emitted so we can skip no-op prop updates.
  const lastEmittedMarkdown = useRef(content);
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [isImageDialogOpen, setIsImageDialogOpen] = useState(false);
  const [isTableDialogOpen, setIsTableDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [tableRows, setTableRows] = useState("3");
  const [tableCols, setTableCols] = useState("3");
  const [imageError, setImageError] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const localImageInputRef = useRef<HTMLInputElement | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // Using CodeBlockLowlight instead
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: "plaintext",
      }),
      ...(toolbarPreset === "full"
        ? [
            Table.configure({ resizable: true }),
            TableRow,
            TableCell,
            TableHeader,
            Image.configure({ inline: false, allowBase64: true }),
            Link.configure({
              openOnClick: false,
              HTMLAttributes: {
                class: "text-foreground hover:underline cursor-pointer",
              },
            }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Highlight.configure({ multicolor: true }),
          ]
        : []),
      Typography,
    ],
    content: markdownToHtml(content),
    editable,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        // We only set a minimal class here; actual styling is in styles.css
        // via the `.tiptap` class that TipTap adds automatically.
        class: "tiptap notes-prose focus:outline-none min-h-[200px]",
      },
    },
    onUpdate: ({ editor: ed }) => {
      isInternalChange.current = true;
      const html = ed.getHTML();
      const markdown = htmlToMarkdown(html);
      lastEmittedMarkdown.current = markdown;
      onChangeRef.current(markdown);
      onHtmlChangeRef.current?.(html);
    },
  });

  // Only apply external content changes (e.g. version restore, note switch).
  // Skip if the change came from the editor itself (user typing).
  useEffect(() => {
    if (!editor) return;

    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }

    // Skip if the incoming content matches what we last emitted
    if (content === lastEmittedMarkdown.current) return;

    // Genuinely external change - apply it.
    const html = markdownToHtml(content);
    editor.commands.setContent(html, { emitUpdate: false });
    lastEmittedMarkdown.current = content;
  }, [editor, content]);

  // Update editable state
  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editor, editable]);

  const addLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    setLinkUrl(previousUrl ?? "");
    setIsLinkDialogOpen(true);
  }, [editor]);

  const addImage = useCallback(() => {
    setImageUrl("");
    setImageError("");
    setIsImageDialogOpen(true);
  }, []);

  const insertTable = useCallback(() => {
    setTableRows("3");
    setTableCols("3");
    setIsTableDialogOpen(true);
  }, []);

  const submitLink = useCallback(() => {
    if (!editor) return;
    const trimmed = linkUrl.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setIsLinkDialogOpen(false);
      return;
    }

    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
    setIsLinkDialogOpen(false);
  }, [editor, linkUrl]);

  const submitImage = useCallback(() => {
    if (!editor) return;
    const trimmed = imageUrl.trim();
    if (!trimmed) return;
    editor.chain().focus().setImage({ src: trimmed }).run();
    setIsImageDialogOpen(false);
    setImageUrl("");
    setImageError("");
  }, [editor, imageUrl]);

  const handlePickLocalImage = useCallback(() => {
    localImageInputRef.current?.click();
  }, []);

  const handleLocalImageSelected = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (!editor) return;
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setImageError("Please choose an image file.");
        e.target.value = "";
        return;
      }

      setImageError("");
      setIsUploadingImage(true);
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string") {
          editor.chain().focus().setImage({ src: result }).run();
          setIsImageDialogOpen(false);
          setImageUrl("");
        } else {
          setImageError("Could not read image file.");
        }
        setIsUploadingImage(false);
      };
      reader.onerror = () => {
        setImageError("Could not read image file.");
        setIsUploadingImage(false);
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [editor]
  );

  const submitTable = useCallback(() => {
    if (!editor) return;
    const rows = Math.max(1, Math.min(10, Number.parseInt(tableRows, 10) || 3));
    const cols = Math.max(1, Math.min(10, Number.parseInt(tableCols, 10) || 3));
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setIsTableDialogOpen(false);
  }, [editor, tableRows, tableCols]);

  if (!editor) {
    return (
      <div className={cn("notes-editor-surface flex flex-col overflow-hidden", className)}>
        <div className="notes-editor-toolbar h-10" />
        <div className="flex-1 min-h-[200px] skeleton" />
      </div>
    );
  }

  return (
    <>
      <div className={cn("notes-editor-surface flex flex-col overflow-hidden", className)}>
        <EditorToolbar
          editor={editor}
          onAddLink={addLink}
          onAddImage={addImage}
          onInsertTable={insertTable}
          preset={toolbarPreset}
        />
        <EditorContent editor={editor} className="notes-editor-content flex-1 overflow-y-auto" />
      </div>

      <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Insert link</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitLink();
            }}
          >
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://example.com"
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="neutral" onClick={() => setIsLinkDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Apply</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isImageDialogOpen} onOpenChange={setIsImageDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Insert image</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitImage();
            }}
          >
            <Input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.png"
              autoFocus
            />
            <input
              ref={localImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLocalImageSelected}
            />
            <Button
              type="button"
              variant="neutral"
              className="w-full"
              onClick={handlePickLocalImage}
              disabled={isUploadingImage}
            >
              {isUploadingImage ? "Uploading..." : "Upload from computer"}
            </Button>
            {imageError && <p className="text-xs text-destructive">{imageError}</p>}
            <DialogFooter>
              <Button type="button" variant="neutral" onClick={() => setIsImageDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!imageUrl.trim()}>
                Insert
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isTableDialogOpen} onOpenChange={setIsTableDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Insert table</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitTable();
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min={1}
                max={10}
                value={tableRows}
                onChange={(e) => setTableRows(e.target.value)}
                placeholder="Rows"
              />
              <Input
                type="number"
                min={1}
                max={10}
                value={tableCols}
                onChange={(e) => setTableCols(e.target.value)}
                placeholder="Columns"
              />
            </div>
            <p className="text-xs text-muted-foreground">Table supports 1 to 10 rows/columns.</p>
            <DialogFooter>
              <Button type="button" variant="neutral" onClick={() => setIsTableDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Insert</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
