// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Which address goes in the QR. A Linux laptop with Docker, libvirt or a VPN has bridges and tunnels with private
// addresses a phone can't reach; the interface the default route leaves by is the one the phone shares. A Mac keeps
// en0 first. The fixtures are this project's Linux build host as `ip -4 addr` and /proc/net/route showed it (Docker,
// six compose bridges, Tailscale, wired Ethernet), a Wi-Fi laptop with Docker and libvirt, and a Mac.
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { defaultRouteInterface, hostCandidates, selectCandidates } from '../src/network';

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: '255.255.0.0',
  family: 'IPv4',
  mac: '02:42:00:00:00:00',
  internal,
  cidr: `${address}/16`,
});
const v6 = (address: string): NetworkInterfaceInfo => ({
  address,
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: '02:42:00:00:00:00',
  internal: false,
  cidr: `${address}/64`,
  scopeid: 0,
});

const BUILD_HOST = {
  lo: [v4('127.0.0.1', true)],
  enp6s0: [v4('192.168.1.35'), v6('fe80::1')],
  tailscale0: [v4('100.91.197.36')],
  'br-30045f210c90': [v4('172.23.0.1')],
  'br-40dfb369df4b': [v4('172.20.0.1')],
  'br-89e822480459': [v4('172.18.0.1')],
  docker0: [v4('172.17.0.1')],
  'br-efba3e9c04a5': [v4('172.19.0.1')],
  'br-fe5d2958978c': [v4('172.21.0.1')],
  'br-2be5c4931e86': [v4('172.22.0.1')],
  veth3f1c2a0: [v4('169.254.12.7')],
};
const BUILD_HOST_ROUTES = `Iface	Destination	Gateway 	Flags	RefCnt	Use	Metric	Mask		MTU	Window	IRTT
enp6s0	00000000	0101A8C0	0003	0	0	100	00000000	0	0	0
docker0	000011AC	00000000	0001	0	0	0	0000FFFF	0	0	0
br-89e822480459	000012AC	00000000	0001	0	0	0	0000FFFF	0	0	0
br-efba3e9c04a5	000013AC	00000000	0001	0	0	0	0000FFFF	0	0	0
enp6s0	0001A8C0	00000000	0001	0	0	100	00FFFFFF	0	0	0
`;

describe('the QR address on Linux', () => {
  it('on the build host: Ethernet only, never a Docker bridge, a veth or Tailscale', () => {
    const route = defaultRouteInterface(BUILD_HOST_ROUTES);
    expect(route).toBe('enp6s0');
    expect(selectCandidates(BUILD_HOST, route)).toEqual([{ name: 'enp6s0', address: '192.168.1.35' }]);
    // Without the route table the bridges are still skipped by name.
    expect(selectCandidates(BUILD_HOST)).toEqual([{ name: 'enp6s0', address: '192.168.1.35' }]);
  });

  it('a Wi-Fi laptop with Docker, libvirt, VirtualBox and a VPN offers its Wi-Fi address', () => {
    const laptop = {
      docker0: [v4('172.17.0.1')],
      virbr0: [v4('192.168.122.1')],
      vnet0: [v4('192.168.122.12')],
      vboxnet0: [v4('192.168.56.1')],
      lxcbr0: [v4('10.0.3.1')],
      wg0: [v4('10.8.0.2')],
      tun0: [v4('10.9.0.6')],
      tap0: [v4('10.10.0.1')],
      zt5u4abc12: [v4('10.147.17.3')],
      wlp2s0: [v4('192.168.0.23')],
    };
    expect(selectCandidates(laptop, 'wlp2s0')).toEqual([{ name: 'wlp2s0', address: '192.168.0.23' }]);
    expect(selectCandidates(laptop)).toEqual([{ name: 'wlp2s0', address: '192.168.0.23' }]);
  });

  it('puts the default route first, then wired and Wi-Fi names, then the rest', () => {
    const two = {
      eth0: [v4('10.0.0.5')],
      usb0: [v4('192.168.42.10')],
      wlan0: [v4('192.168.1.20')],
    };
    expect(selectCandidates(two, 'wlan0').map((entry) => entry.name)).toEqual(['wlan0', 'eth0', 'usb0']);
    expect(selectCandidates(two).map((entry) => entry.name)).toEqual(['eth0', 'wlan0', 'usb0']);
    // A default route through a VPN tunnel is no candidate: the LAN interfaces keep their order.
    expect(selectCandidates({ ...two, wg0: [v4('10.8.0.2')] }, 'wg0').map((entry) => entry.name)).toEqual([
      'eth0',
      'wlan0',
      'usb0',
    ]);
  });

  it('reads the default route from /proc/net/route: the lowest metric, only routes in use', () => {
    const header = 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n';
    const row = (name: string, flags: string, metric: number, destination = '00000000', mask = '00000000') =>
      `${name}\t${destination}\t0101A8C0\t${flags}\t0\t0\t${metric}\t${mask}\t0\t0\t0\n`;
    expect(defaultRouteInterface(header + row('enp6s0', '0003', 100) + row('wlp2s0', '0003', 600))).toBe(
      'enp6s0',
    );
    expect(defaultRouteInterface(header + row('enp6s0', '0003', 700) + row('wlp2s0', '0003', 600))).toBe(
      'wlp2s0',
    );
    expect(defaultRouteInterface(header + row('enp6s0', '0002', 100))).toBeUndefined();
    expect(defaultRouteInterface(header + row('docker0', '0001', 0, '000011AC', '0000FFFF'))).toBeUndefined();
    expect(defaultRouteInterface('')).toBeUndefined();
    expect(defaultRouteInterface('not a table')).toBeUndefined();
  });
});

describe('the QR address on a Mac', () => {
  it('keeps en0 first and skips tunnels, AirDrop and Internet Sharing', () => {
    const mac = {
      lo0: [v4('127.0.0.1', true)],
      en1: [v4('192.168.1.40')],
      en0: [v4('192.168.1.41')],
      utun3: [v4('10.0.85.2')],
      awdl0: [v6('fe80::2')],
      bridge100: [v4('192.168.2.1')],
      anpi0: [v4('169.254.3.3')],
    };
    expect(selectCandidates(mac)).toEqual([
      { name: 'en0', address: '192.168.1.41' },
      { name: 'en1', address: '192.168.1.40' },
    ]);
  });
});

describe('this computer', () => {
  it('offers no virtual interface, whatever it has', () => {
    for (const { name } of hostCandidates())
      expect(name).not.toMatch(/^(docker|br-|virbr|veth|tun|tap|tailscale|wg|zt|utun|bridge)/);
  });
});
