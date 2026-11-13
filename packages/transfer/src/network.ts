// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export interface LanInterface {
  readonly name: string;
  readonly address: string;
}

/** Candidates a session can bind, best first, and a watch for address changes. */
export interface NetworkInfo {
  candidates(): LanInterface[];
  /** Polls. The returned function stops the watch. */
  watch(onChange: () => void): () => void;
}

/**
 * Interfaces a phone on the Wi-Fi can't reach. macOS: VPN tunnels, AirDrop, Internet Sharing's bridge, VMware.
 * Linux: Docker's and libvirt's bridges and their veth pairs, containers' (LXC, Incus, Podman, Kubernetes),
 * VirtualBox's host-only network, tun/tap, and VPNs (Tailscale, WireGuard, ZeroTier, NordLynx, Hamachi). Windows:
 * Hyper-V's and WSL's switches.
 */
const SKIPPED =
  /^(utun|ipsec|ppp|awdl|llw|bridge|vmnet|anpi|docker|br-|virbr|veth|vnet|lxcbr|lxdbr|incusbr|podman|cni|flannel|cali|kube|vboxnet|tun|tap|tailscale|wg|zt|nordlynx|ham\d|vEthernet)/;

/** IPv4 private (10/8, 172.16/12, 192.168/16) or link-local (169.254/16). */
export function isLanAddress(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function isLoopbackAddress(address: string): boolean {
  return address.startsWith('127.');
}

/** One private or link-local IPv4 address. Loopback only when a test asks. Never 0.0.0.0 or IPv6. */
export function isBindableAddress(address: string, allowLoopback = false): boolean {
  if (!address || address === '0.0.0.0' || address.includes(':')) return false;
  if (isLanAddress(address)) return true;
  return allowLoopback && isLoopbackAddress(address);
}

/**
 * From `os.networkInterfaces()`: IPv4, not internal, private or link-local, virtual interfaces skipped. The
 * interface the default route leaves by comes first when it is known (Linux), then `en0`, then other wired and
 * Wi-Fi names (`en*`, `eth*`, `wl*`), then the rest.
 */
export function selectCandidates(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  defaultRoute?: string,
): LanInterface[] {
  const found: LanInterface[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries || SKIPPED.test(name)) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!isLanAddress(entry.address)) continue;
      found.push({ name, address: entry.address });
    }
  }
  const rank = (name: string) => {
    if (name === defaultRoute) return 0;
    if (name === 'en0') return 1;
    if (/^(en|eth|wl)/.test(name)) return 2;
    return 3;
  };
  found.sort((left, right) => rank(left.name) - rank(right.name) || left.name.localeCompare(right.name));
  return found;
}

/**
 * The interface the IPv4 default route leaves by, from Linux's `/proc/net/route` (the lowest metric when there are
 * several); undefined when there is none or the table can't be read.
 */
export function defaultRouteInterface(routeTable: string): string | undefined {
  let best: { name: string; metric: number } | undefined;
  for (const line of routeTable.split('\n').slice(1)) {
    const [name, destination, , flags, , , metric, mask] = line.trim().split(/\s+/);
    if (!name || destination !== '00000000' || mask !== '00000000') continue;
    // RTF_UP (0x1): the route is in use.
    if ((Number.parseInt(flags ?? '0', 16) & 0x1) === 0) continue;
    const value = Number(metric);
    if (!Number.isFinite(value)) continue;
    if (!best || value < best.metric) best = { name, metric: value };
  }
  return best?.name;
}

/** The default route's interface on Linux; elsewhere (macOS keeps `en0` first) undefined. */
function readDefaultRoute(): string | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    return defaultRouteInterface(readFileSync('/proc/net/route', 'utf8'));
  } catch {
    return undefined;
  }
}

/** This computer's candidates, now. */
export function hostCandidates(): LanInterface[] {
  return selectCandidates(networkInterfaces(), readDefaultRoute());
}

export function nodeNetworkInfo(pollMs = 5_000): NetworkInfo {
  return {
    candidates: hostCandidates,
    watch(onChange) {
      let previous = JSON.stringify(hostCandidates());
      const timer = setInterval(() => {
        const next = JSON.stringify(hostCandidates());
        if (next === previous) return;
        previous = next;
        onChange();
      }, pollMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
