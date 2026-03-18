import { Code, Globe, Radio, SshKey, Zap, type IconComponent } from "@/lib/icons";
import type { ComposerProtocol } from "@/types/composer";

export type ComposerCreatableProtocol = Exclude<ComposerProtocol, "ssh">;

type ProtocolMeta = {
  label: string;
  requestLabel: string;
  blurb: string;
  icon: IconComponent;
  colorClass: string;
};

const PROTOCOL_META: Record<ComposerProtocol, ProtocolMeta> = {
  http: {
    label: "HTTP",
    requestLabel: "HTTP Request",
    blurb: "REST, webhooks, and API endpoints",
    icon: Globe,
    colorClass: "text-info",
  },
  sip: {
    label: "SIP",
    requestLabel: "SIP Request",
    blurb: "Signaling, registration, and call control",
    icon: Radio,
    colorClass: "text-info",
  },
  ssh: {
    label: "SSH",
    requestLabel: "SSH Connection",
    blurb: "Secure remote shell and tunneling",
    icon: SshKey,
    colorClass: "text-primary",
  },
  websocket: {
    label: "WebSocket",
    requestLabel: "WebSocket",
    blurb: "Realtime bidirectional messaging",
    icon: Zap,
    colorClass: "text-warning",
  },
  graphql: {
    label: "GraphQL",
    requestLabel: "GraphQL",
    blurb: "Typed schema-based API queries",
    icon: Code,
    colorClass: "text-destructive",
  },
};

export const CREATABLE_PROTOCOLS: readonly ComposerCreatableProtocol[] = [
  "sip",
  "http",
  "websocket",
  "graphql",
];

export function getProtocolMeta(protocol: ComposerProtocol): ProtocolMeta {
  return PROTOCOL_META[protocol];
}
