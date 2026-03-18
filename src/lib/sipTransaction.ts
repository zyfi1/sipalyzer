/**
 * SIP transaction grouping by CSeq + method for ladder highlight.
 */

import type { SipDialogMessage } from "@/types/forensics";

/** Group message indices by SIP transaction (same CSeq). Returns array of { transactionKey, messageIndices }. */
export function groupMessagesByTransaction(messages: SipDialogMessage[]): { transactionKey: string; messageIndices: number[] }[] {
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg === undefined) continue;
    const cseq = msg.cseq ?? `i${i}`;
    if (!byKey.has(cseq)) byKey.set(cseq, []);
    byKey.get(cseq)!.push(i);
  }
  return Array.from(byKey.entries()).map(([transactionKey, messageIndices]) => ({
    transactionKey,
    messageIndices,
  }));
}

/** Get the set of message indices that belong to the same transaction as the message at hoverIndex. */
export function getTransactionIndicesForMessage(
  messages: SipDialogMessage[],
  hoverIndex: number
): Set<number> {
  const groups = groupMessagesByTransaction(messages);
  for (const g of groups) {
    if (g.messageIndices.includes(hoverIndex)) {
      return new Set(g.messageIndices);
    }
  }
  return new Set([hoverIndex]);
}
