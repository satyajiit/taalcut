// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DebugCollectOptions, DebugSection } from '@taalcut/core';
import { buildDebugBundle, type MainDebugEnvironment } from '../src/main/debug/assemble';
import {
  createFeedback,
  feedbackRouter,
  readSavedBundle,
  type FeedbackDeps,
} from '../src/main/debug/feedback';
import { clearDebugLogs } from '../src/main/debug/log-ring';
import { scanBundle } from '../src/main/debug/scan-bundle';
import { startIngest, type MockIngest } from './helpers/mock-ingest';

const HOME = '/Users/nobody-home';
const roots: string[] = [];
let ingest: MockIngest | undefined;

const environment = (): MainDebugEnvironment => ({
  version: '1.2.3',
  channel: 'alpha',
  os: 'darwin',
  chip: 'arm64',
  memory: { bytes: 1024 },
  tier: 'high',
  shortfalls: [],
  gpu: { hardwareAcceleration: true },
  components: [],
  flavour: 'test',
});

const options: DebugCollectOptions = { includeChatText: false };

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-feedback-'));
  roots.push(dir);
  return dir;
}

function jpegSection(): DebugSection {
  return {
    section: 'traces',
    process: 'agent',
    path: 'agent/traces/run.json',
    mediaType: 'application/json',
    text: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString('latin1'),
    redactions: { text: 0, paths: 0, secrets: 0 },
  };
}

function service(dir: string, over: Partial<FeedbackDeps> = {}, collector?: () => readonly DebugSection[]) {
  const calls = { chosen: 0 };
  const feedback = createFeedback({
    dsn: ingest?.dsn ?? '',
    localOnly: () => false,
    version: '1.2.3',
    channel: 'alpha',
    secrets: [],
    homeDir: HOME,
    choose: async (name) => {
      calls.chosen += 1;
      return join(dir, name);
    },
    scan: (sections) => scanBundle(sections, { secrets: [], homeDir: HOME }),
    build: (input) =>
      buildDebugBundle(
        {
          environment,
          recovery: () => ({ restoredFromBackup: null, needsAttention: false }),
          collectors: collector ? [async () => collector()] : [],
          secrets: [],
          homeDir: HOME,
        },
        input,
      ),
    ...over,
  });
  return { feedback, calls };
}

beforeEach(async () => {
  clearDebugLogs();
  ingest = await startIngest();
});

afterEach(async () => {
  await ingest?.close();
  ingest = undefined;
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('feedback', () => {
  it('posts one envelope when send is asked', async () => {
    const { feedback } = service(scratch());
    const sent = await feedback.send({ message: 'the export stalled', bundle: options });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.value.id).toMatch(/^[0-9a-f]{32}$/);
    expect(ingest?.bodies).toHaveLength(1);
    const body = ingest?.bodies[0]?.toString('utf8') ?? '';
    expect(body).toContain('"type":"feedback"');
    expect(body).toContain('the export stalled');
    expect(body).toContain('taalcut@1.2.3');
    expect(body).toContain('"type":"attachment"');
    expect(feedbackRouter).toBeTypeOf('function');
  });

  it('sends nothing when the scan refuses the bundle', async () => {
    const { feedback, calls } = service(scratch(), {}, () => [jpegSection()]);
    const sent = await feedback.send({ message: 'see attached', bundle: options });
    expect(sent.ok).toBe(false);
    if (sent.ok) return;
    expect(sent.error.code).toBe('desktop.debug_bundle_unsafe');
    expect(sent.error.params).toMatchObject({ rule: 'media_magic' });
    expect(JSON.stringify(sent.error)).not.toContain('JFIF');
    expect(ingest?.bodies).toHaveLength(0);
    expect(calls.chosen).toBe(0);
  });

  it('refuses a send while local only is on', async () => {
    let built = 0;
    const { feedback } = service(scratch(), {
      localOnly: () => true,
      build: async () => {
        built += 1;
        throw new Error('should not build');
      },
    });
    const sent = await feedback.send({ message: 'hello', bundle: options });
    expect(sent.ok).toBe(false);
    if (sent.ok) return;
    expect(sent.error.code).toBe('core.local_only');
    expect(sent.error.params).toEqual({ what: 'feedback' });
    expect(built).toBe(0);
    expect(ingest?.bodies).toHaveLength(0);
  });

  it('previews sizes without writing or sending', async () => {
    const dir = scratch();
    const { feedback, calls } = service(dir);
    const preview = await feedback.preview(options);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.sections.length).toBeGreaterThan(0);
    expect(preview.value.totalBytes).toBeGreaterThan(0);
    expect(preview.value.sections.every((item) => !Object.hasOwn(item, 'text'))).toBe(true);
    expect(calls.chosen).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
    expect(ingest?.bodies).toHaveLength(0);
  });

  it('saves without a DSN and refuses the send', async () => {
    const dir = scratch();
    const { feedback } = service(dir, { dsn: '' });
    const sent = await feedback.send({ message: 'hello', bundle: null });
    expect(sent.ok).toBe(false);
    if (sent.ok) return;
    expect(sent.error.code).toBe('desktop.feedback_unavailable');
    const saved = await feedback.saveBundle(options);
    expect(saved.ok).toBe(true);
    if (!saved.ok || !saved.value.saved || !saved.value.fileName) return;
    expect(saved.value.fileName).toMatch(/^Taalcut-debug-\d{4}-\d{2}-\d{2}-\d{4}\.json\.gz$/);
    const file = join(dir, saved.value.fileName);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const parsed = readSavedBundle(readFileSync(file)) as { manifest: { version: number } };
    expect(parsed.manifest.version).toBe(1);
    expect(ingest?.bodies).toHaveLength(0);
  });
});
