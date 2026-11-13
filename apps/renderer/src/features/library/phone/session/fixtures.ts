// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shape of a typical session, for the skeletons: the bone capture renders these in place of data
 * (`pnpm --filter @taalcut/renderer bones:capture`), and while the session starts the real layout renders them
 * hidden under the bones so the bones scale to it. Never shown to anyone as data.
 */
import type { SourceView, TransferPairing, TransferSession } from '@taalcut/core';

const AT = Date.UTC(2026, 9, 13, 9, 30);

export const FIXTURE_PAIRING: TransferPairing = {
  qrText: 'http://192.168.1.24:52817/#k=Zml4dHVyZS1vbmx5LW5vdC1hLXRva2Vu',
  code: '7KD2M9QX',
  pin: '482913',
};

export const FIXTURE_SESSION: TransferSession = {
  id: '01K7C5M6Q8PH0NE0000000000S' as TransferSession['id'],
  state: 'listening',
  url: 'http://192.168.1.24:52817',
  network: { interface: 'en0', address: '192.168.1.24', reachable: 'yes' },
  idleStopAt: AT + 10 * 60_000,
  pairingResets: 0,
  devices: [],
  totals: { files: 0, done: 0, failed: 0, bytes: 0, bytesDone: 0 },
  startedAt: AT,
};

const source = ({
  n,
  name,
  kind,
  assets,
}: Pick<SourceView, 'name' | 'kind' | 'assets'> & { n: number }): SourceView => ({
  id: `01K7C5M6Q8PH0NE000000000${n}S` as SourceView['id'],
  kind,
  name,
  status: 'online',
  path: null,
  watch: false,
  scan: { state: 'idle', lastScanAt: null },
  assets,
  missing: 0,
  createdAt: AT - n * 86_400_000,
});

/** Earlier imports from phones, as library.sources lists them. */
export const FIXTURE_HISTORY: readonly SourceView[] = [
  source({ n: 1, name: 'iPhone 16 Pro', kind: 'wifi_import', assets: 12 }),
  source({ n: 2, name: 'Pixel 9', kind: 'usb_import', assets: 48 }),
  source({ n: 3, name: 'iPhone 16 Pro', kind: 'wifi_import', assets: 3 }),
];
