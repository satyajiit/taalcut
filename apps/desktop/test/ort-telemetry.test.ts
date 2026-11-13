// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ONNX Runtime's own telemetry stays off: every utility process sets the
 * switch before anything can load ORT, and the ORT build we ship still reads
 * that switch (an upgrade that renamed it would post to Microsoft again).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { disableOrtTelemetry, ORT_TELEMETRY_ENV } from '../src/shared/ort-telemetry';
import { runUtility } from '../src/utility/runtime';

const saved = process.env[ORT_TELEMETRY_ENV];

/** libonnxruntime from the onnxruntime-node the app depends on, on this platform (undefined elsewhere). */
function ortLibrary(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  const entry = createRequire(import.meta.url).resolve('onnxruntime-node');
  const dir = join(dirname(entry), '..', 'bin', 'napi-v6', 'darwin', process.arch);
  const name = readdirSync(dir).find((file) => /^libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(file));
  return name ? join(dir, name) : undefined;
}

describe('ONNX Runtime telemetry', () => {
  afterEach(() => {
    if (saved === undefined) delete process.env[ORT_TELEMETRY_ENV];
    else process.env[ORT_TELEMETRY_ENV] = saved;
  });

  it('is switched off by every utility process before it composes', () => {
    delete process.env[ORT_TELEMETRY_ENV];
    const handle = runUtility(
      'lan',
      () => Promise.reject(new Error('not composed')),
      new EventEmitter(),
      () => {},
    );
    expect(process.env[ORT_TELEMETRY_ENV]).toBe('1');
    void handle.dispose();
    const env: Record<string, string | undefined> = {};
    disableOrtTelemetry(env);
    expect(env).toEqual({ ORT_DISABLE_TELEMETRY: '1' });
  });

  it('is read by the ORT build the app ships, under that name', () => {
    const library = ortLibrary();
    if (!library) return;
    const bytes = readFileSync(library).toString('latin1');
    if (!bytes.includes('events.data.microsoft.com')) return; // no telemetry in this build
    expect(bytes).toContain(ORT_TELEMETRY_ENV);
  });
});
