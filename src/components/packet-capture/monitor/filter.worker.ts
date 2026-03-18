/**
 * Web Worker stub for Wireshark filter evaluation.
 * Full implementation would require moving evaluateWiresharkFilter (and its helpers)
 * to a worker-safe module (no React/DOM). Until then, RawPacketMonitor uses
 * chunked main-thread filtering via requestIdleCallback to keep the UI responsive.
 */
import type { PacketInfo } from "@/types/packetCapture";

export type FilterWorkerRequest = {
  filter: string;
  packets: PacketInfo[];
};

export type FilterWorkerResponse = {
  indices: number[];
};

self.onmessage = (e: MessageEvent<FilterWorkerRequest>) => {
  const { packets } = e.data;
  // Stub: return all indices (no filtering). Replace with evaluateWiresharkFilter when moved to a worker-safe module.
  const indices = Array.from({ length: packets.length }, (_, i) => i);
  self.postMessage({ indices } satisfies FilterWorkerResponse);
};
