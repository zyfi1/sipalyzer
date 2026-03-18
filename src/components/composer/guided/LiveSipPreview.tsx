/**
 * Live SIP message preview — renders a formatted SIP message
 * that updates in real-time as the user modifies fields.
 */

import { useMemo } from "react";
import { Copy, CheckCircle2 } from "@/lib/icons";
import { useState, useCallback } from "react";
import type { SipTransport, SipMethod, SipDigestAuth } from "@/types/crafter";
import { cn } from "@/lib/utils";
import { generateCallId, generateBranch, generateFromTag } from "@/stores/composerStore";

interface LiveSipPreviewProps {
  method: SipMethod;
  uri: string;
  transport: SipTransport;
  headers: Array<{ key: string; value: string }>;
  body: string;
  auth?: SipDigestAuth | null;
  hintText?: string;
  className?: string;
}

const PREVIEW_LOCAL_SIP_HOST = "localhost";
const PREVIEW_LOCAL_SIP_PORT = 5062;

export function LiveSipPreview({
  method,
  uri,
  transport,
  headers,
  body,
  hintText,
  className,
}: LiveSipPreviewProps) {
  const [copied, setCopied] = useState(false);

  const message = useMemo(() => {
    const targetUri = uri || "sip:example.com";
    const sipVersion = "SIP/2.0";
    const requestLine = `${method} ${targetUri} ${sipVersion}`;

    const callId = generateCallId();
    const branch = generateBranch();
    const fromTag = generateFromTag();

    const builtInHeaders: Array<{ key: string; value: string }> = [
      { key: "Via", value: `${sipVersion}/${transport} ${PREVIEW_LOCAL_SIP_HOST}:${PREVIEW_LOCAL_SIP_PORT};branch=${branch};rport` },
      { key: "Max-Forwards", value: "70" },
      { key: "From", value: `<sip:sipalyzer@${PREVIEW_LOCAL_SIP_HOST}>;tag=${fromTag}` },
      { key: "To", value: `<${targetUri}>` },
      { key: "Call-ID", value: callId },
      { key: "CSeq", value: `1 ${method}` },
      { key: "Contact", value: `<sip:sipalyzer@${PREVIEW_LOCAL_SIP_HOST}:${PREVIEW_LOCAL_SIP_PORT};transport=${transport.toLowerCase()}>` },
    ];

    const userHeaders = headers.filter((h) => h.key.trim());
    const builtInKeys = new Set(builtInHeaders.map((h) => h.key.toLowerCase()));
    const extraUserHeaders = userHeaders.filter(
      (h) => !builtInKeys.has(h.key.toLowerCase())
    );
    const overriddenBuiltIn = builtInHeaders.map((bh) => {
      const override = userHeaders.find(
        (uh) => uh.key.toLowerCase() === bh.key.toLowerCase()
      );
      return override ?? bh;
    });

    const allHeaders = [...overriddenBuiltIn, ...extraUserHeaders];

    if (body) {
      const contentLenExists = allHeaders.some(
        (h) => h.key.toLowerCase() === "content-length"
      );
      if (!contentLenExists) {
        allHeaders.push({ key: "Content-Length", value: String(new TextEncoder().encode(body).length) });
      }
    } else {
      allHeaders.push({ key: "Content-Length", value: "0" });
    }

    return { requestLine, headers: allHeaders, body };
  }, [method, uri, transport, headers, body]);

  const fullText = useMemo(() => {
    const lines = [
      message.requestLine,
      ...message.headers.map((h) => `${h.key}: ${h.value}`),
      "",
    ];
    if (message.body) lines.push(message.body);
    return lines.join("\r\n");
  }, [message]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [fullText]);

  return (
    <div className={cn("flex flex-col surface overflow-hidden", className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/20 bg-muted/10">
        <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
          SIP Message Preview
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-smooth"
        >
          {copied ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-success" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Message body */}
      <div className="flex-1 min-h-0 overflow-auto p-3 font-mono text-2xs leading-relaxed select-text">
        {/* Request line */}
        <div className="text-foreground font-semibold">
          <span className="text-primary">{message.requestLine.split(" ")[0]}</span>
          <span className="text-foreground"> {message.requestLine.split(" ").slice(1).join(" ")}</span>
        </div>

        {/* Headers */}
        {message.headers.map((h, idx) => (
          <div key={idx}>
            <span className="text-muted-foreground">{h.key}:</span>{" "}
            <span className="text-foreground/80">{h.value}</span>
          </div>
        ))}

        {/* Blank line */}
        <div className="h-2" />

        {/* Body */}
        {message.body && (
          <div className="text-foreground/80 text-2xs whitespace-pre-wrap">
            {message.body}
          </div>
        )}
      </div>

      {/* Hint text */}
      {hintText && (
        <div className="px-3 py-2 border-t border-border/20 bg-muted/10">
          <p className="text-2xs text-muted-foreground/70 leading-relaxed">
            <span className="font-medium text-muted-foreground">What to expect:</span>{" "}
            {hintText}
          </p>
        </div>
      )}
    </div>
  );
}
