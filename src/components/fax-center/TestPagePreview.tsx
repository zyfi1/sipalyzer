/**
 * Preview of the actual generated fax test page.
 * Fetches the real TIFF from the backend (fax_get_prebuilt_test_doc) and displays it.
 */
import { useEffect, useRef, useState } from "react";
import { getPrebuiltTestDoc } from "@/api/fax";
import { cn } from "@/lib/utils";

interface TestPagePreviewProps {
  className?: string;
  variant?: "thumbnail" | "preview";
  /** Prebuilt doc id to fetch and display (e.g. "itu_test_page") */
  docId?: string;
  /** Show short explanation below the page */
  showExplanation?: boolean;
}

function base64ToBlobUrl(base64: string, mime: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

export function TestPagePreview({
  className,
  variant = "preview",
  docId = "itu_test_page",
  showExplanation = true,
}: TestPagePreviewProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [format, setFormat] = useState<string>("tiff");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const isThumb = variant === "thumbnail";

  useEffect(() => {
    if (!docId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBlobUrl(null);

    getPrebuiltTestDoc(docId)
      .then((res) => {
        if (res.data_base64) {
          const fmt = res.format.toLowerCase();
          setFormat(fmt);

          // Determine MIME type based on format
          let mime = "image/tiff";
          if (fmt === "pdf") {
            mime = "application/pdf";
          } else if (fmt === "png") {
            mime = "image/png";
          } else if (fmt === "jpeg" || fmt === "jpg") {
            mime = "image/jpeg";
          }

          const url = base64ToBlobUrl(res.data_base64, mime);
          blobUrlRef.current = url;
          setBlobUrl(url);
        } else {
          setError("No preview data");
        }
      })
      .catch((e) => setError(e?.message ?? "Failed to load preview"))
      .finally(() => setLoading(false));

    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [docId]);

  if (loading) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div
          className={cn(
            "rounded-lg bg-muted/30 overflow-hidden flex items-center justify-center",
            isThumb ? "w-24 aspect-[1/1.3]" : "w-full max-w-sm aspect-[1/1.3]"
          )}
          aria-label="Loading preview"
        >
          <span className="text-xs text-muted-foreground">Loading…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div
          className={cn(
            "rounded-lg bg-destructive/10 overflow-hidden flex items-center justify-center p-3",
            isThumb ? "w-24 aspect-[1/1.3]" : "w-full max-w-sm aspect-[1/1.3]"
          )}
        >
          <span className="text-xs text-destructive text-center">{error}</span>
        </div>
      </div>
    );
  }

  // For TIFF files, browsers don't natively support display, so show a placeholder
  // In the future, we could use a TIFF.js library to render it
  const isTiff = format === "tiff" || format === "tif";
  const isPdf = format === "pdf";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className={cn(
          "rounded-lg bg-foreground overflow-hidden shadow-card flex flex-col items-center justify-center",
          isThumb ? "w-24 aspect-[1/1.3]" : "w-full max-w-md min-h-[320px]"
        )}
        aria-label="Generated test page preview"
      >
        {isPdf && blobUrl && (
          <iframe
            src={`${blobUrl}#toolbar=0&navpanes=0`}
            title="Generated test page PDF"
            className={cn(
              "w-full border-0 bg-foreground flex-1 min-h-0",
              isThumb ? "min-h-0" : "min-h-[300px]"
            )}
          />
        )}
        {isTiff && (
          <div className="flex flex-col items-center justify-center p-6 text-center gap-4">
            {/* Fax test page visual representation */}
            <div className="w-full max-w-[280px] bg-foreground border-2 border-border rounded shadow-card p-4 space-y-3">
              {/* Header */}
              <div className="border-b border-border pb-2">
                <div className="text-xs font-bold text-foreground text-center">
                  STRIX FAX TEST PAGE
                </div>
                <div className="text-2xs text-muted-foreground text-center mt-1">
                  ITU-T Standard Test Document
                </div>
              </div>

              {/* Test pattern - horizontal lines */}
              <div className="space-y-1">
                {[...Array(8)].map((_, i) => (
                  <div
                    key={i}
                    className="h-[2px] bg-card"
                    style={{ opacity: 1 - i * 0.1 }}
                  />
                ))}
              </div>

              {/* Resolution info */}
              <div className="text-3xs text-muted-foreground/70 text-center space-y-0.5">
                <div>204 × 98 DPI (Standard Resolution)</div>
                <div>1728 pixels width (US Letter)</div>
                <div>CCITT Group 4 Compression</div>
              </div>

              {/* Test text */}
              <div className="shadow-card rounded p-2 bg-muted">
                <div className="text-3xs font-mono text-foreground leading-tight">
                  ABCDEFGHIJKLMNOPQRSTUVWXYZ
                  <br />
                  abcdefghijklmnopqrstuvwxyz
                  <br />
                  0123456789 !@#$%^&*()
                </div>
              </div>

              {/* Footer */}
              <div className="text-3xs text-muted-foreground text-center pt-1 border-t border-border">
                T.38 / G.711 Fax Verification
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Fax-compatible TIFF (1-bit, 1728px width)
            </p>
          </div>
        )}
        {!isPdf && !isTiff && blobUrl && (
          <img
            src={blobUrl}
            alt="Test page preview"
            className="w-full h-auto object-contain"
          />
        )}
      </div>
      {showExplanation && !isThumb && (
        <p className="text-xs text-muted-foreground max-w-md">
          {isTiff
            ? "Standard fax test page in TIFF format. When you click Send, this document is transmitted using T.38 (preferred) or G.711 audio passthrough."
            : "Actual generated file from the backend. When you click Send, this same file is used to verify the fax path."}
        </p>
      )}
    </div>
  );
}
