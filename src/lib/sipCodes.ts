/**
 * SIP response code and method color scheme + icon system.
 * Canonical styling for SIP dialogs, ladder views, packet capture, etc.
 */

import {
  CheckCircle,
  Check,
  XCircle,
  X,
  AlertTriangle,
  ArrowRightLeft,
  Info,
  BellRing,
  Phone,
  PhoneOff,
  LogIn,
  ArrowRight,
} from "@/lib/icons";

export type SipCodeVariant =
  | "1xx"   // Informational
  | "2xx"   // Success
  | "3xx"   // Redirection
  | "4xx"   // Client Error
  | "5xx"   // Server Error
  | "6xx"   // Global Failure
  | "invite"
  | "ack"
  | "bye"
  | "cancel"
  | "register"
  | "default";

export interface SipCodeStyle {
  variant: SipCodeVariant;
  /** Tailwind text color class */
  textColor: string;
  /** Tailwind bg color class (e.g. bg-emerald-500/20) */
  bgColor: string;
  /** Tailwind border color class (optional) */
  borderColor?: string;
  /** Icon component */
  Icon: React.ComponentType<{ className?: string; size?: number }>;
  /** Human-readable label */
  label: string;
}

function parseCode(methodOrCode: string): number | null {
  const m = methodOrCode.trim();
  const match = m.match(/^(\d{3})/);
  return match ? parseInt(match[1]!, 10) : null;
}

function parseMethod(methodOrCode: string): string {
  return methodOrCode.trim().toUpperCase().split(/\s+/)[0] ?? "";
}

/** Full SIP code style: colors + icon + label. */
export function getSipCodeStyle(methodOrCode: string): SipCodeStyle {
  const code = parseCode(methodOrCode);
  const method = parseMethod(methodOrCode);

  if (code != null) {
    if (code >= 100 && code < 200) {
      return {
        variant: "1xx",
        textColor: "text-primary",
        bgColor: "bg-primary/20",
        borderColor: "border-primary/30",
        Icon: BellRing,
        label: "Informational",
      };
    }
    if (code >= 200 && code < 300) {
      return {
        variant: "2xx",
        textColor: "text-success",
        bgColor: "bg-success/20",
        borderColor: "border-success/30",
        Icon: CheckCircle,
        label: "Success",
      };
    }
    if (code >= 300 && code < 400) {
      return {
        variant: "3xx",
        textColor: "text-warning",
        bgColor: "bg-warning/20",
        borderColor: "border-warning/30",
        Icon: ArrowRightLeft,
        label: "Redirection",
      };
    }
    if (code >= 400 && code < 500) {
      return {
        variant: "4xx",
        textColor: "text-warning",
        bgColor: "bg-warning/20",
        borderColor: "border-warning/30",
        Icon: AlertTriangle,
        label: "Client Error",
      };
    }
    if (code >= 500 && code < 600) {
      return {
        variant: "5xx",
        textColor: "text-destructive",
        bgColor: "bg-destructive/20",
        borderColor: "border-destructive/30",
        Icon: XCircle,
        label: "Server Error",
      };
    }
    if (code >= 600) {
      return {
        variant: "6xx",
        textColor: "text-destructive",
        bgColor: "bg-destructive/20",
        borderColor: "border-destructive/30",
        Icon: XCircle,
        label: "Global Failure",
      };
    }
  }

  switch (method) {
    case "INVITE":
    case "REFER":
      return {
        variant: "invite",
        textColor: "text-primary",
        bgColor: "bg-primary/20",
        borderColor: "border-primary/30",
        Icon: Phone,
        label: "Request",
      };
    case "ACK":
      return {
        variant: "ack",
        textColor: "text-success",
        bgColor: "bg-success/20",
        borderColor: "border-success/30",
        Icon: Check,
        label: "Acknowledgment",
      };
    case "BYE":
      return {
        variant: "bye",
        textColor: "text-muted-foreground",
        bgColor: "bg-muted/50",
        borderColor: "border-muted-foreground/30",
        Icon: PhoneOff,
        label: "Terminate",
      };
    case "CANCEL":
      return {
        variant: "cancel",
        textColor: "text-destructive",
        bgColor: "bg-destructive/20",
        borderColor: "border-destructive/30",
        Icon: X,
        label: "Cancel",
      };
    case "REGISTER":
      return {
        variant: "register",
        textColor: "text-muted-foreground",
        bgColor: "bg-muted/50",
        borderColor: "border-muted-foreground/30",
        Icon: LogIn,
        label: "Register",
      };
    case "OPTIONS":
    case "INFO":
    case "NOTIFY":
    case "SUBSCRIBE":
    case "UPDATE":
    case "MESSAGE":
    case "PUBLISH":
      return {
        variant: "default",
        textColor: "text-primary",
        bgColor: "bg-primary/20",
        borderColor: "border-primary/30",
        Icon: ArrowRight,
        label: "Request",
      };
    default:
      return {
        variant: "default",
        textColor: "text-muted-foreground",
        bgColor: "bg-muted/50",
        borderColor: "border-muted-foreground/30",
        Icon: Info,
        label: "Other",
      };
  }
}

/** Tailwind classes for compact pill/badge (no icon). */
export function getSipPillClasses(methodOrCode: string): string {
  const { textColor, bgColor, borderColor } = getSipCodeStyle(methodOrCode);
  return [bgColor, textColor, borderColor].filter(Boolean).join(" ");
}

/** Tailwind text color for arrow/line (e.g. in ladder diagram). */
export function getSipArrowColorClass(methodOrCode: string): string {
  const { textColor } = getSipCodeStyle(methodOrCode);
  return textColor;
}

/** Rich badge classes with glow shadow (for ladder diagram, etc.). */
export function getSipBadgeClasses(methodOrCode: string): string {
  const base = getSipPillClasses(methodOrCode);
  const { variant } = getSipCodeStyle(methodOrCode);
  const shadows: Record<string, string> = {
    "1xx": "shadow-[0_0_6px_hsl(var(--primary)/0.25)]",
    "2xx": "shadow-[0_0_6px_hsl(var(--success)/0.25)]",
    "3xx": "shadow-[0_0_6px_hsl(var(--warning)/0.25)]",
    "4xx": "shadow-[0_0_6px_hsl(var(--warning)/0.25)]",
    "5xx": "shadow-[0_0_6px_hsl(var(--destructive)/0.25)]",
    "6xx": "shadow-[0_0_6px_hsl(var(--destructive)/0.25)]",
    invite: "shadow-[0_0_6px_hsl(var(--primary)/0.25)]",
    ack: "shadow-[0_0_6px_hsl(var(--success)/0.25)]",
    bye: "shadow-[0_0_6px_hsl(var(--muted-foreground)/0.15)]",
    cancel: "shadow-[0_0_6px_hsl(var(--destructive)/0.25)]",
    register: "shadow-[0_0_6px_hsl(var(--muted-foreground)/0.15)]",
    default: "",
  };
  const shadow = shadows[variant] ?? "";
  return [base, shadow].filter(Boolean).join(" ");
}
