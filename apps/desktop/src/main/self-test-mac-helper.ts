// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `--taalcut-self-test=mac-helper` (test builds only; test-hooks.ts): the mac helper as the app's utility processes
 * find it (src/utility/roots/mac-helper-resolver.ts). In a packaged app that is Resources/bin, checked against the pin
 * packaging baked into this bundle (packaging/mac-helper.ts), then started for its ready line under the hardened
 * runtime. Prints where it was found, the baked pin and the ready line's protocol and version, or the refusal:
 * media.sidecar_pin_mismatch for a swapped helper or a bundle without a pin.
 */
import { createJsonLineSidecar, type JsonValue } from '@taalcut/media';
import { macHelperResolver } from '../utility/roots/mac-helper-resolver';

export async function macHelperSelfTest(
  workDir: string,
  packaged: boolean,
): Promise<Record<string, unknown>> {
  const pin = __TAALCUT_MAC_HELPER_PIN__;
  const found = await macHelperResolver({ packaged, resourcesPath: process.resourcesPath }).resolve();
  if (!found.ok) return { error: found.error.code, detail: found.error.detail ?? '', pin };
  const helper = createJsonLineSidecar({
    command: found.value.path,
    args: ['serve', '--services', 'image', '--allow-root', workDir],
    readyTimeoutMs: 20_000,
  });
  try {
    const ready = await helper.ready();
    if (!ready.ok) return { error: ready.error.code, detail: ready.error.detail ?? '', pin };
    return {
      ...found.value,
      pin,
      protocol: field(ready.value, 'protocol'),
      version: field(ready.value, 'version'),
    };
  } finally {
    await helper.close();
  }
}

/** One field of the ready line, or null. */
function field(line: JsonValue, key: string): JsonValue {
  if (typeof line !== 'object' || line === null) return null;
  return Object.entries(line).find(([name]) => name === key)?.[1] ?? null;
}
