"use client";

import { useState } from "react";
import { Copy, Check } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyTextButtonProps {
  /** Text to copy to clipboard. */
  text: string;
  /** Optional label (e.g. "Copy request"). Shown as title and aria-label. */
  label?: string;
  /** Optional class for the button. */
  className?: string;
  /** Show label next to icon. Default: icon only. */
  showLabel?: boolean;
  /** Size: sm or icon-only. */
  size?: "sm" | "icon";
}

/**
 * Dedicated copy button that copies the given text. Use next to pre/code blocks
 * or any area where copying the whole content is relevant.
 */
export function CopyTextButton({
  text,
  label = "Copy",
  className,
  showLabel = false,
  size = "icon",
}: CopyTextButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "sm" : "icon"}
      onClick={handleCopy}
      title={copied ? "Copied!" : label}
      aria-label={copied ? "Copied" : label}
      className={cn(
        "shrink-0",
        size === "icon" && "h-8 w-8",
        copied && "text-success",
        className
      )}
    >
      {copied ? (
        <Check className="h-4 w-4 text-success" />
      ) : (
        <Copy className="h-4 w-4 text-muted-foreground" />
      )}
      {showLabel && (
        <span className={cn("ml-1.5", copied && "text-success")}>
          {copied ? "Copied" : "Copy"}
        </span>
      )}
    </Button>
  );
}
