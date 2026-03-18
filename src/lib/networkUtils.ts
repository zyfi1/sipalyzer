/**
 * Shared network detection logic: pick best local IP from interfaces.
 * Used by networkStore, Header, and packet capture. Single source of truth.
 */

import type { NetworkInterface } from "@/types/packetCapture";

export function isVpnInterface(iface: NetworkInterface): boolean {
  const name = iface.name.toLowerCase();
  return (
    name.includes("utun") ||
    name.includes("tun") ||
    name.includes("vpn") ||
    name.includes("ppp") ||
    name.includes("tap")
  );
}

export function cleanAddress(addr: string): string {
  return (addr.includes(":") ? addr.split("%")[0] : addr) ?? addr;
}

function isValidIPv4(clean: string): boolean {
  if (clean.includes(":")) return false;
  if (clean.startsWith("127.")) return false;
  if (clean.startsWith("169.254.")) return false;
  return true;
}

function isPrivateIPv4(clean: string): boolean {
  if (clean.startsWith("10.")) return true;
  if (clean.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return true;
  if (clean.startsWith("192.168.")) return true;
  return false;
}

/**
 * Pick the best local IPv4 address from the given interfaces.
 * Priority: default-route (outbound) only, then physical (non-VPN). VPN only when it is default route.
 */
export function pickBestLocalIp(interfaces: NetworkInterface[]): string | null {
  const cleanAddr = (addr: string) => cleanAddress(addr);

  // 1. Default-route interface (outbound IP — correct for VPN when active)
  for (const iface of interfaces) {
    if (!iface.isDefault) continue;
    for (const addr of iface.addresses) {
      const clean = cleanAddr(addr);
      if (isValidIPv4(clean)) {
        return clean;
      }
    }
  }

  // 2. Non-VPN with public IPs (physical/WiFi/Ethernet)
  for (const iface of interfaces) {
    if (isVpnInterface(iface)) continue;
    for (const addr of iface.addresses) {
      const clean = cleanAddr(addr);
      if (isValidIPv4(clean) && !isPrivateIPv4(clean)) {
        return clean;
      }
    }
  }

  // 3. Non-VPN with private IPs
  for (const iface of interfaces) {
    if (isVpnInterface(iface)) continue;
    for (const addr of iface.addresses) {
      const clean = cleanAddr(addr);
      if (isValidIPv4(clean)) {
        return clean;
      }
    }
  }

  // 4. VPN interfaces only as last resort (e.g. no default route set)
  for (const iface of interfaces) {
    if (!isVpnInterface(iface)) continue;
    for (const addr of iface.addresses) {
      const clean = cleanAddr(addr);
      if (isValidIPv4(clean)) {
        return clean;
      }
    }
  }

  // 5. Any IPv4
  for (const iface of interfaces) {
    for (const addr of iface.addresses) {
      const clean = cleanAddr(addr);
      if (!clean.includes(":") && clean.includes(".")) {
        return clean;
      }
    }
  }

  return null;
}
