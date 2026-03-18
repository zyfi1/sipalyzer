import { useState } from "react";
import { Copy, Check, Loader2, Globe, Server, Shield } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useIpInfo } from "@/hooks/useIpInfo";
import { TooltipWrapper } from "./tooltip-wrapper";

interface IpAddressProps {
  ip: string;
  className?: string;
  showCopyOnHover?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "mono" | "inline";
  /** Show IP intelligence tooltip (hostname, ASN, org, country). Defaults to true. */
  showIpInfo?: boolean;
}

// ─── IP Info Tooltip Content ────────────────────────────────────────────────

function IpInfoTooltipContent({ ip }: { ip: string }) {
  const { info, isLoading } = useIpInfo(ip);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Looking up {ip}...</span>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="space-y-0.5">
        <p className="font-medium text-foreground leading-snug font-mono text-xs">{ip}</p>
      </div>
    );
  }

  if (info.isPrivate) {
    return (
      <div className="space-y-1.5 min-w-[180px]">
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-medium text-foreground leading-snug font-mono text-xs">{ip}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Shield className="h-3 w-3 shrink-0" />
          <span>Private / local address</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 min-w-[200px] max-w-[340px]">
      {/* IP + hostname */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-foreground shrink-0" />
          <span className="font-medium text-foreground leading-snug font-mono text-xs">{ip}</span>
        </div>
        {info.hostname && (
          <p className="text-xs text-muted-foreground font-mono truncate pl-6">{info.hostname}</p>
        )}
      </div>

      {/* Details grid */}
      {(info.org || info.asn || info.country || info.prefix) && (
        <div className="border-t border-border/50 pt-1.5 space-y-1 text-xs">
          {info.org && (
            <div className="flex items-start gap-2">
              <Server className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-foreground leading-snug">{info.org}</span>
            </div>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-5">
            {info.asn && (
              <>
                <span className="text-muted-foreground">ASN</span>
                <span className="text-foreground font-mono">{info.asn}</span>
              </>
            )}
            {info.country && (
              <>
                <span className="text-muted-foreground">Country</span>
                <span className="text-foreground">{info.country}</span>
              </>
            )}
            {info.prefix && (
              <>
                <span className="text-muted-foreground">Prefix</span>
                <span className="text-foreground font-mono">{info.prefix}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

/**
 * Reusable IP address component with copy-to-clipboard + IP intelligence tooltip.
 * For external IPs: shows hostname, ASN, ISP, country, prefix on hover.
 * For private IPs: shows a "Private / local address" badge.
 */
export function IpAddress({
  ip,
  className,
  showCopyOnHover = true,
  size = "md",
  variant = "default",
  showIpInfo = true,
}: IpAddressProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const cleanIp = (ip.includes(":") ? ip.split("%")[0] : undefined) ?? ip;
    await navigator.clipboard.writeText(cleanIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
    lg: "h-4 w-4",
  };

  // The copy button element (shared across variants)
  const copyButton = (
    <TooltipWrapper title={copied ? "Copied!" : "Copy IP address"} side="bottom">
      <button
        onClick={handleCopy}
        className={cn(
          "transition-[color,opacity,background-color] duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)] rounded p-0.5 flex-shrink-0",
          copied
            ? "opacity-100 text-success"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        {copied ? (
          <Check className={cn(iconSizes[size], "animate-in fade-in zoom-in duration-[var(--motion-duration-overlay)] [transition-timing-function:var(--motion-ease-overlay)]")} />
        ) : (
          <Copy className={iconSizes[size]} />
        )}
      </button>
    </TooltipWrapper>
  );

  // The IP text element
  const ipText = <span className={cn("font-mono", sizeClasses[size])}>{ip}</span>;

  // Wrap the IP text in a tooltip if showIpInfo is enabled
  const wrappedIpText = showIpInfo ? (
    <TooltipWrapper content={<IpInfoTooltipContent ip={ip} />}>
      <span className={cn("font-mono cursor-help", sizeClasses[size])}>{ip}</span>
    </TooltipWrapper>
  ) : (
    ipText
  );

  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center", className)}>
        {wrappedIpText}
        <span
          className={cn(
            "transition-[width,opacity,margin-left] duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)] flex-shrink-0 h-[18px] flex items-center justify-center overflow-hidden",
            showCopyOnHover && "w-0 group-hover:w-[18px] opacity-0 group-hover:opacity-100 ml-0 group-hover:ml-1.5",
            !showCopyOnHover && "w-[18px] ml-1.5",
            copied && "opacity-100 bg-success/20 text-success w-[18px] ml-1.5"
          )}
        >
          {copyButton}
        </span>
      </span>
    );
  }

  if (variant === "mono") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 group", className)}>
        {wrappedIpText}
        <span
          className={cn(
            "transition-opacity duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]",
            showCopyOnHover && "opacity-0 group-hover:opacity-100",
            copied && "opacity-100"
          )}
        >
          {copyButton}
        </span>
      </span>
    );
  }

  // Default variant
  return (
    <div className={cn("flex items-center gap-2 group", className)}>
      {wrappedIpText}
      <span
        className={cn(
          "transition-opacity duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]",
          showCopyOnHover && "opacity-0 group-hover:opacity-100",
          copied && "opacity-100"
        )}
      >
        {copyButton}
      </span>
    </div>
  );
}
