import { useMemo, useState, useCallback } from "react";
import { MetricCard } from "../components/MetricCard";
import { ResultSourceBadge } from "../components/ResultSourceBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { Scan, Globe, Loader2, Play, Shield, Search, RefreshCw } from "@/lib/icons";
import { tooltips } from "@/lib/tooltips";
import * as api from "@/api/networkTest";
import type { SnmpPollResult } from "@/types/networkTest";
import { useExecutionContextStore } from "@/stores/executionContextStore";
import { dispatchSnmpPoll } from "@/lib/executionDispatch";

type V3SecurityLevel = "noAuthNoPriv" | "authNoPriv" | "authPriv";
type V3AuthProtocol = "md5" | "sha1" | "sha224" | "sha256" | "sha384" | "sha512";
type V3PrivacyProtocol = "des" | "aes128" | "aes192" | "aes256";

export default function SnmpPanel() {
  const [host, setHost] = useState("");
  const [community, setCommunity] = useState("public");
  const [version, setVersion] = useState<1 | 2 | 3>(2);

  const [v3Username, setV3Username] = useState("");
  const [v3AuthPassword, setV3AuthPassword] = useState("");
  const [v3PrivPassword, setV3PrivPassword] = useState("");
  const [v3SecurityLevel, setV3SecurityLevel] = useState<V3SecurityLevel>("authNoPriv");
  const [v3AuthProtocol, setV3AuthProtocol] = useState<V3AuthProtocol>("sha256");
  const [v3PrivacyProtocol, setV3PrivacyProtocol] = useState<V3PrivacyProtocol>("aes128");

  const [ifaceQuery, setIfaceQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SnmpPollResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<{ source: "local" | "remote"; agentId?: string } | null>(null);

  const resolvedContext = useExecutionContextStore((s) => s.resolvedContext);
  const resolvedAgentName = useExecutionContextStore((s) => s.resolvedAgentName);
  const ctx = resolvedContext("snmpPoll");
  const agentName = lastSource?.source === "remote" ? (resolvedAgentName("snmpPoll") ?? undefined) : undefined;

  const missingV3Creds =
    version === 3 &&
    (!v3Username.trim() ||
      (v3SecurityLevel !== "noAuthNoPriv" && !v3AuthPassword.trim()) ||
      (v3SecurityLevel === "authPriv" && !v3PrivPassword.trim()));
  const canPoll = !!host.trim() && !running && !missingV3Creds;

  const resetForm = () => {
    setHost("");
    setCommunity("public");
    setVersion(2);
    setV3Username("");
    setV3AuthPassword("");
    setV3PrivPassword("");
    setV3SecurityLevel("authNoPriv");
    setV3AuthProtocol("sha256");
    setV3PrivacyProtocol("aes128");
    setIfaceQuery("");
    setResult(null);
    setError(null);
  };

  const handleRun = useCallback(async () => {
    if (!canPoll) return;
    setRunning(true);
    setError(null);
    try {
      const v3Payload =
        version === 3
          ? {
              username: v3Username || undefined,
              authPassword: v3AuthPassword || undefined,
              privPassword: v3PrivPassword || undefined,
              securityLevel: v3SecurityLevel,
              authProtocol: v3AuthProtocol,
              privacyProtocol: v3PrivacyProtocol,
            }
          : undefined;

      if (ctx.type !== "local") {
        const res = await dispatchSnmpPoll(
          ctx,
          () => api.networkSnmpPoll(host.trim(), community || undefined, version, v3Payload),
          {
            host: host.trim(),
            community: community || undefined,
            version,
            ...(version === 3
              ? {
                  v3Username: v3Username || undefined,
                  v3AuthPassword: v3AuthPassword || undefined,
                  v3PrivPassword: v3PrivPassword || undefined,
                  v3SecurityLevel,
                  v3AuthProtocol,
                  v3PrivacyProtocol,
                }
              : {}),
          },
        );
        setResult(res.result as SnmpPollResult);
        setLastSource({ source: res.source, agentId: res.agentId });
      } else {
        const r = await api.networkSnmpPoll(host.trim(), community || undefined, version, v3Payload);
        setResult(r);
        setLastSource({ source: "local" });
      }
    } catch (e: any) {
      setError(e.message ?? "SNMP poll failed");
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [
    canPoll,
    host,
    community,
    version,
    v3Username,
    v3AuthPassword,
    v3PrivPassword,
    v3SecurityLevel,
    v3AuthProtocol,
    v3PrivacyProtocol,
    ctx,
  ]);

  const interfaces = result?.interfaces ?? [];
  const filteredInterfaces = useMemo(() => {
    const q = ifaceQuery.trim().toLowerCase();
    if (!q) return interfaces;
    return interfaces.filter((iface) => {
      return (
        iface.description.toLowerCase().includes(q) ||
        iface.type.toLowerCase().includes(q) ||
        iface.oper_status.toLowerCase().includes(q) ||
        String(iface.index).includes(q)
      );
    });
  }, [interfaces, ifaceQuery]);

  const upCount = interfaces.filter((i) => i.oper_status.toLowerCase() === "up").length;
  const downCount = interfaces.filter((i) => i.oper_status.toLowerCase() === "down").length;
  const errCount = interfaces.filter((i) => i.in_errors + i.out_errors > 0).length;

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col gap-4">
      <div className="ui-hero-surface app-view-surface-pad space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="section-label mb-1">SNMP Inspector</h3>
            <p className="text-xs text-muted-foreground">
              Enter a target, choose SNMP version, and run a poll.
            </p>
          </div>
          {lastSource && <ResultSourceBadge source={lastSource.source} agentName={agentName} />}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Target IP or hostname"
              className="h-10 pl-9"
              disabled={running}
              onKeyDown={(e) => e.key === "Enter" && handleRun()}
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={String(version)}
              onChange={(e) => setVersion(Number(e.target.value) as 1 | 2 | 3)}
              className="ui-control-shell h-10 rounded-lg px-3 text-sm"
              disabled={running}
            >
              <option value="1">SNMP v1</option>
              <option value="2">SNMP v2c</option>
              <option value="3">SNMP v3</option>
            </select>
            <Button className="h-10 px-5 gap-2" onClick={handleRun} disabled={!canPoll}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Poll
            </Button>
            <Button variant="ghost" className="h-10 px-3" onClick={resetForm} disabled={running}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {version !== 3 ? (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
            <div className="relative">
              <Shield className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
              <Input
                value={community}
                onChange={(e) => setCommunity(e.target.value)}
                placeholder="Community string (default: public)"
                className="h-9 pl-8"
                disabled={running}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-9" onClick={() => setCommunity("public")} disabled={running}>
                public
              </Button>
              <Button variant="ghost" size="sm" className="h-9" onClick={() => setCommunity("private")} disabled={running}>
                private
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input
                value={v3Username}
                onChange={(e) => setV3Username(e.target.value)}
                placeholder="v3 username"
                className="h-9"
                disabled={running}
              />
              <select
                value={v3SecurityLevel}
                onChange={(e) => setV3SecurityLevel(e.target.value as V3SecurityLevel)}
                className="ui-control-shell h-9 rounded-lg px-3 text-sm"
                disabled={running}
              >
                <option value="noAuthNoPriv">noAuthNoPriv</option>
                <option value="authNoPriv">authNoPriv</option>
                <option value="authPriv">authPriv</option>
              </select>
              <select
                value={v3AuthProtocol}
                onChange={(e) => setV3AuthProtocol(e.target.value as V3AuthProtocol)}
                className="ui-control-shell h-9 rounded-lg px-3 text-sm"
                disabled={running}
              >
                <option value="md5">MD5</option>
                <option value="sha1">SHA1</option>
                <option value="sha224">SHA224</option>
                <option value="sha256">SHA256</option>
                <option value="sha384">SHA384</option>
                <option value="sha512">SHA512</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input
                value={v3AuthPassword}
                onChange={(e) => setV3AuthPassword(e.target.value)}
                placeholder="Auth password"
                type="password"
                className="h-9"
                disabled={running || v3SecurityLevel === "noAuthNoPriv"}
              />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  value={v3PrivPassword}
                  onChange={(e) => setV3PrivPassword(e.target.value)}
                  placeholder="Privacy password"
                  type="password"
                  className="h-9"
                  disabled={running || v3SecurityLevel !== "authPriv"}
                />
                <select
                  value={v3PrivacyProtocol}
                  onChange={(e) => setV3PrivacyProtocol(e.target.value as V3PrivacyProtocol)}
                  className="ui-control-shell h-9 rounded-lg px-3 text-sm"
                  disabled={running || v3SecurityLevel !== "authPriv"}
                >
                  <option value="des">DES</option>
                  <option value="aes128">AES128</option>
                  <option value="aes192">AES192</option>
                  <option value="aes256">AES256</option>
                </select>
              </div>
            </div>
            {missingV3Creds && (
              <p className="text-2xs text-warning">
                Fill required v3 credentials for the selected security level.
              </p>
            )}
          </div>
        )}
      </div>

      {!result && !running && !error && (
        <div className="ui-hero-surface flex-1 min-h-0">
          <EmptyState
            variant="inline"
            icon={<Scan />}
            title="No SNMP data yet"
            description="Run a poll to load system info and interface counters."
            className="h-full min-h-0 p-6"
          />
        </div>
      )}

      {running && !result && (
        <div className="ui-hero-surface app-view-surface-pad">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Polling SNMP...</span>
          </div>
        </div>
      )}

      {error && !running && (
        <div className="ui-hero-surface app-view-surface-pad">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {result && (
        <div className="flex-1 min-h-0 w-full space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Interfaces" value={String(interfaces.length)} />
            <MetricCard label="Up" value={String(upCount)} status={upCount > 0 ? "pass" : "idle"} />
            <MetricCard label="Down" value={String(downCount)} status={downCount > 0 ? "warn" : "idle"} />
            <MetricCard label="With Errors" value={String(errCount)} status={errCount > 0 ? "fail" : "pass"} />
          </div>

          <div className="ui-hero-surface app-view-surface-pad space-y-4">
            <h3 className="section-label">System</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TooltipWrapper entry={tooltips.netSnmpSysName}>
                <div className="cursor-help">
                  <MetricCard label="Name" value={result.system_info.sys_name || "--"} />
                </div>
              </TooltipWrapper>
              <TooltipWrapper entry={tooltips.netSnmpUptime}>
                <div className="cursor-help">
                  <MetricCard label="Uptime" value={result.system_info.sys_uptime || "--"} />
                </div>
              </TooltipWrapper>
              <MetricCard label="Contact" value={result.system_info.sys_contact || "--"} />
              <MetricCard label="Location" value={result.system_info.sys_location || "--"} />
            </div>
            {result.system_info.sys_descr && (
              <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 font-mono break-all">
                {result.system_info.sys_descr}
              </div>
            )}
          </div>

          <div className="ui-hero-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between gap-2">
              <h3 className="section-label">
                Interfaces ({filteredInterfaces.length}/{interfaces.length})
              </h3>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
                <Input
                  value={ifaceQuery}
                  onChange={(e) => setIfaceQuery(e.target.value)}
                  placeholder="Filter interfaces..."
                  className="ui-control-shell h-8 w-52 pl-8 text-xs"
                />
              </div>
            </div>
            {filteredInterfaces.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Interface</th>
                      <th className="px-3 py-2 text-center font-medium text-muted-foreground">Status</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Speed</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">In</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Out</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Err</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInterfaces.map((iface) => (
                      <tr key={iface.index} className="border-b border-border/20 hover:bg-muted/20 transition-smooth">
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{iface.index}</td>
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{iface.description || "--"}</div>
                          {iface.type && <div className="text-2xs text-muted-foreground">{iface.type}</div>}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <Badge variant={iface.oper_status === "up" ? "default" : "outline"} className="text-3xs px-1.5 py-0 h-4">
                            {iface.oper_status || "--"}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{iface.speed > 0 ? formatSpeed(iface.speed) : "--"}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{formatBytes(iface.in_octets)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{formatBytes(iface.out_octets)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-destructive/80">
                          {iface.in_errors + iface.out_errors > 0 ? `${iface.in_errors}/${iface.out_errors}` : "0"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                variant="inline"
                title="No interfaces match your filter"
                description="Try a different interface search term."
                className="h-full min-h-0 p-6"
              />
            )}
          </div>

          <div className="text-2xs text-muted-foreground/60 text-right px-1">
            Completed in {result.elapsed_ms}ms
          </div>
        </div>
      )}
    </div>
  );
}

function formatSpeed(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(0)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(0)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0";
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}
