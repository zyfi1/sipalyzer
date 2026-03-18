import { useState, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Clipboard } from "@/lib/icons";

import { useToolStore } from "@/stores/toolStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { usePacketCaptureStore } from "@/stores/packetCaptureStore";
import { useRemoteAgentStore } from "@/stores/remoteAgentStore";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useErrorStore } from "@/stores/errorStore";
import { useComposerStore } from "@/stores/composerStore";
import { useNoteStore } from "@/stores/noteStore";

interface StoreEntry {
  label: string;
  getter: () => unknown;
}

const STORE_MAP: Record<string, StoreEntry> = {
  toolStore: { label: "Active Tools", getter: () => useToolStore.getState() },
  layoutStore: { label: "Layout & Panels", getter: () => useLayoutStore.getState() },
  settingsStore: { label: "App Settings", getter: () => useSettingsStore.getState() },
  packetCaptureStore: { label: "Packet Capture", getter: () => usePacketCaptureStore.getState() },
  remoteAgentStore: { label: "Remote Agent", getter: () => useRemoteAgentStore.getState() },
  softphoneStore: { label: "Softphone", getter: () => useSoftphoneStore.getState() },
  registrationStore: { label: "SIP Registrations", getter: () => useRegistrationStore.getState() },
  errorStore: { label: "Captured Errors", getter: () => useErrorStore.getState() },
  composerStore: { label: "SIP Composer", getter: () => useComposerStore.getState() },
  noteStore: { label: "Notes", getter: () => useNoteStore.getState() },
};

function safeStringify(val: unknown): string {
  try {
    return JSON.stringify(
      val,
      (_, v) => {
        if (typeof v === "function") return "[function]";
        if (v instanceof Map) return Object.fromEntries(v);
        if (v instanceof Set) return Array.from(v);
        return v;
      },
      2,
    );
  } catch {
    return String(val);
  }
}

export function StateInspectorView() {
  const [selected, setSelected] = useState("toolStore");
  const [tick, setTick] = useState(0);

  const json = useMemo(() => {
    const entry = STORE_MAP[selected];
    if (!entry) return "{}";
    try {
      return safeStringify(entry.getter());
    } catch {
      return "Error reading store";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, tick]);

  const handleCopy = () => {
    navigator.clipboard.writeText(json);
  };

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-auto">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="h-8 w-[220px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STORE_MAP).map(([key, entry]) => (
              <SelectItem key={key} value={key}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="neutral"
          size="sm"
          onClick={() => setTick((t) => t + 1)}
          className="h-8 text-xs"
        >
          Refresh
        </Button>
        <Button
          variant="neutral"
          size="sm"
          onClick={handleCopy}
          className="h-8 text-xs"
        >
          <Clipboard className="h-3.5 w-3.5 mr-1" />
          Copy
        </Button>
      </div>

      {/* JSON viewer */}
      <div className="flex-1 overflow-auto ui-panel-shell rounded-lg p-4 font-mono text-xs whitespace-pre-wrap break-all">
        {json}
      </div>

      {/* Storage section */}
      <div className="ui-panel-shell rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/50">
          <p className="section-title">Browser Storage (localStorage)</p>
        </div>
        <div className="divide-y divide-border/30 max-h-[200px] overflow-auto">
          {Object.keys(localStorage).map((key) => (
            <div
              key={key}
              className="flex items-center gap-3 px-4 py-2"
            >
              <span className="text-xs font-medium w-[200px] truncate">
                {key}
              </span>
              <span className="text-xs text-muted-foreground font-mono flex-1 truncate">
                {(localStorage.getItem(key) ?? "").slice(0, 120)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
