/**
 * SSH Config Import — parse ~/.ssh/config and bulk-import hosts into collections.
 */

import { useState, useCallback } from "react";
import { useComposerStore, newItemId } from "@/stores/composerStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToastContext } from "@/contexts/ToastContext";
import { Download, Check, SshKey } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { ComposerItem } from "@/types/composer";
import { DEFAULT_SSH_ADVANCED } from "@/types/composer";

interface SshConfigImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedHost {
  name: string;
  host: string;
  port: number;
  username: string;
  keyFile: string;
  jumpHost: string;
  selected: boolean;
}

/**
 * Parse SSH config text into structured host entries.
 */
function parseSshConfig(text: string): ParsedHost[] {
  const hosts: ParsedHost[] = [];
  let current: ParsedHost | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(\S+)\s+(.+)/);
    if (!match) continue;
    const configKey = match[1]!;
    const configValue = match[2]!;
    const keyLower = configKey.toLowerCase();

    if (keyLower === "host") {
      if (configValue.includes("*")) continue;
      if (current) hosts.push(current);
      current = {
        name: configValue,
        host: configValue,
        port: 22,
        username: "",
        keyFile: "",
        jumpHost: "",
        selected: true,
      };
    } else if (current) {
      switch (keyLower) {
        case "hostname":
          current.host = configValue;
          break;
        case "port":
          current.port = parseInt(configValue) || 22;
          break;
        case "user":
          current.username = configValue;
          break;
        case "identityfile":
          current.keyFile = configValue;
          break;
        case "proxyjump":
          current.jumpHost = configValue;
          break;
      }
    }
  }
  if (current) hosts.push(current);
  return hosts;
}

export function SshConfigImport({ open, onOpenChange }: SshConfigImportProps) {
  const addItem = useComposerStore((s) => s.addItem);
  const toast = useToastContext();

  const [configText, setConfigText] = useState("");
  const [parsedHosts, setParsedHosts] = useState<ParsedHost[]>([]);
  const [step, setStep] = useState<"paste" | "select">("paste");

  const handleParse = useCallback(() => {
    const hosts = parseSshConfig(configText);
    if (hosts.length === 0) {
      toast.warning("No hosts found", "The SSH config doesn't contain any valid Host entries.", { source: "composer" });
      return;
    }
    setParsedHosts(hosts);
    setStep("select");
  }, [configText, toast]);

  const toggleHost = useCallback((index: number) => {
    setParsedHosts((prev) =>
      prev.map((h, i) => (i === index ? { ...h, selected: !h.selected } : h))
    );
  }, []);

  const handleImport = useCallback(() => {
    const selected = parsedHosts.filter((h) => h.selected);
    if (selected.length === 0) {
      toast.warning("No hosts selected", "Select at least one host to import.", { source: "composer" });
      return;
    }

    const now = Date.now();
    for (const host of selected) {
      const id = newItemId();
      const item: ComposerItem = {
        id,
        protocol: "ssh",
        name: host.name,
        folderId: null,
        notes: "",
        color: "",
        createdAt: now,
        updatedAt: now,
        sshData: {
          host: host.host,
          port: host.port,
          username: host.username,
          authMethod: host.keyFile ? "key" : "agent",
          keyFilePath: host.keyFile,
          portForwards: [],
          advancedOptions: {
            ...DEFAULT_SSH_ADVANCED,
            jumpHost: host.jumpHost,
          },
          lastConnected: null,
        },
      };
      addItem(item);
    }

    toast.success("Imported", `${selected.length} SSH connection${selected.length !== 1 ? "s" : ""} imported.`, { source: "composer" });
    onOpenChange(false);
    setStep("paste");
    setConfigText("");
    setParsedHosts([]);
  }, [parsedHosts, addItem, toast, onOpenChange]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setStep("paste");
    setConfigText("");
    setParsedHosts([]);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>Import SSH Config</DialogTitle>
          <DialogDescription>
            Paste your <code className="text-xs font-mono bg-muted/50 px-1 rounded">~/.ssh/config</code> contents to import hosts as SSH connections.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-3">
          {step === "paste" ? (
            <>
              <Textarea
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                placeholder={`Host myserver\n  HostName 192.168.1.100\n  User admin\n  Port 22\n  IdentityFile ~/.ssh/id_rsa`}
                className="font-mono text-xs min-h-[200px]"
              />
              <Button onClick={handleParse} disabled={!configText.trim()} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Parse Config
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Found {parsedHosts.length} host{parsedHosts.length !== 1 ? "s" : ""}. Select which ones to import:
              </p>
              <div className="space-y-1.5">
                {parsedHosts.map((host, i) => (
                  <label
                    key={i}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-smooth",
                      host.selected ? "bg-accent" : "bg-muted/20 hover:bg-muted/40"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={host.selected}
                      onChange={() => toggleHost(i)}
                      className="rounded"
                    />
                    <SshKey className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{host.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {host.username ? `${host.username}@` : ""}{host.host}:{host.port}
                        {host.keyFile ? ` · key: ${host.keyFile}` : ""}
                        {host.jumpHost ? ` · via ${host.jumpHost}` : ""}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Button variant="neutral" onClick={() => setStep("paste")}>
                  Back
                </Button>
                <Button onClick={handleImport} className="gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  Import {parsedHosts.filter((h) => h.selected).length} Host{parsedHosts.filter((h) => h.selected).length !== 1 ? "s" : ""}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
