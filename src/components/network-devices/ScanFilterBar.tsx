import { useState } from "react";
import { useNetworkDevicesStore } from "@/stores/networkDevicesStore";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, X, ChevronDown } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { DiscoveryMethod } from "@/types/networkDevices";

const DISCOVERY_METHOD_OPTIONS: { value: DiscoveryMethod; label: string }[] = [
  { value: "arp", label: "ARP" },
  { value: "sip", label: "Probe" },
  { value: "both", label: "Both" },
];

const FILTER_SELECT_CLASS =
  "ui-control-shell h-7 rounded-lg px-2.5 text-xs text-foreground focus:outline-none focus-visible:border-foreground/30 transition-[color,box-shadow]";

export function ScanFilterBar() {
  const filter = useNetworkDevicesStore((s) => s.filter);
  const setFilter = useNetworkDevicesStore((s) => s.setFilter);
  const clearFilter = useNetworkDevicesStore((s) => s.clearFilter);
  const getFilteredDevices = useNetworkDevicesStore((s) => s.getFilteredDevices);
  const devices = useNetworkDevicesStore((s) => s.devices);
  const getUniqueVendors = useNetworkDevicesStore((s) => s.getUniqueVendors);

  const [showMore, setShowMore] = useState(false);

  const filteredCount = getFilteredDevices().length;
  const totalCount = devices.length;
  const vendors = getUniqueVendors();
  const hasActiveFilter =
    filter.search || filter.ip || filter.port || filter.openPort || filter.hostname || filter.hasMac ||
    filter.deviceTypes.length > 0 || filter.vendor || filter.discoveryMethod || filter.diffStatus;

  return (
    <div className="space-y-2">
      {/* Primary row: search + count + clear + expand */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={filter.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            placeholder="Search by IP, hostname, MAC, vendor..."
            className="ui-control-shell h-8 pl-8 text-sm"
          />
        </div>

        {/* Quick toggles */}
        <button
          type="button"
          onClick={() => setFilter({ hasMac: !filter.hasMac })}
          className={cn(
            "ui-control-shell inline-flex items-center px-2.5 py-1 rounded-lg text-2xs font-medium transition-smooth shrink-0",
            filter.hasMac
              ? "bg-primary/15 text-primary border-primary/40"
              : "text-muted-foreground hover:border-primary/40",
          )}
        >
          Has MAC
        </button>

        {hasActiveFilter && (
          <Button variant="neutral" size="sm" className="h-8 px-2.5 text-xs gap-1 shrink-0" onClick={clearFilter}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}

        <Badge variant="secondary" className="text-xs shrink-0 tabular-nums">
          {hasActiveFilter ? `${filteredCount} / ${totalCount}` : totalCount}
        </Badge>

        <button
          type="button"
          onClick={() => setShowMore((s) => !s)}
          className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-smooth shrink-0"
        >
          Filters
          <ChevronDown className={cn("h-3 w-3 transition-transform", showMore && "rotate-180")} />
        </button>
      </div>

      {/* Secondary filters (collapsed by default) */}
      {showMore && (
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            value={filter.ip}
            onChange={(e) => setFilter({ ip: e.target.value })}
            placeholder="IP prefix..."
            className="h-7 text-xs font-mono w-32"
          />

          <Input
            value={filter.openPort}
            onChange={(e) => setFilter({ openPort: e.target.value })}
            placeholder="Port..."
            className="h-7 text-xs font-mono w-24"
          />

          <Input
            value={filter.hostname}
            onChange={(e) => setFilter({ hostname: e.target.value })}
            placeholder="Hostname..."
            className="h-7 text-xs w-28"
          />

          {vendors.length > 0 && (
            <select
              value={filter.vendor}
              onChange={(e) => setFilter({ vendor: e.target.value })}
              className={FILTER_SELECT_CLASS}
            >
              <option value="">All vendors</option>
              {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}

          <select
            value={filter.diffStatus}
            onChange={(e) => setFilter({ diffStatus: e.target.value as "" | "new" | "changed" })}
            className={FILTER_SELECT_CLASS}
          >
            <option value="">All changes</option>
            <option value="new">New only</option>
            <option value="changed">Changed only</option>
          </select>

          <select
            value={filter.discoveryMethod}
            onChange={(e) => setFilter({ discoveryMethod: e.target.value as DiscoveryMethod | "" })}
            className={FILTER_SELECT_CLASS}
          >
            <option value="">All methods</option>
            {DISCOVERY_METHOD_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
