// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Review L3: the file outbox writes durably (temp fsynced, renamed, folder fsynced) and a queue that doesn't parse
// is kept aside instead of being replaced by the next write.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, telemetryEnvelopeSchema, type TelemetryEnvelope } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFileTelemetryOutbox,
  telemetryOutboxFile,
  unreadableOutboxFile,
} from '../src/utility/telemetry';
import { sessionEvent } from './helpers/telemetry';

const calls: string[] = [];

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  const paths = new Map<number, string>();
  return {
    ...actual,
    openSync: (path: fs.PathLike, flags: fs.OpenMode) => {
      const fd = actual.openSync(path, flags);
      paths.set(fd, String(path));
      return fd;
    },
    fsyncSync: (fd: number) => {
      calls.push(`fsync ${paths.get(fd) ?? fd}`);
      actual.fsyncSync(fd);
    },
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      calls.push(`rename ${String(from)} -> ${String(to)}`);
      actual.renameSync(from, to);
    },
  };
});

const envelope: TelemetryEnvelope = telemetryEnvelopeSchema.parse({
  v: 1,
  installId: newId<'Install'>(),
  sessionId: newId<'TelemetrySession'>(),
  seq: 1,
  at: 1_700_000_000_000,
  event: sessionEvent(),
});

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'taalcut-file-outbox-'));
  calls.length = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the file telemetry outbox', () => {
  it('fsyncs the temp file before the rename and the folder after it', async () => {
    const file = telemetryOutboxFile(dir);
    await createFileTelemetryOutbox(file).append(envelope);
    const temp = `${file}.${process.pid}.tmp`;
    expect(calls).toEqual([`fsync ${temp}`, `rename ${temp} -> ${file}`, `fsync ${dir}`]);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(temp)).toBe(false);
    expect(await createFileTelemetryOutbox(file).take(10)).toEqual([{ id: 1, envelope }]);
  });

  it('keeps a torn queue aside instead of overwriting it, and clearing deletes that copy', async () => {
    const file = telemetryOutboxFile(dir);
    const torn = '{"nextId":3,"rows":[{"id":1,"envelope":{"v":1,"ins';
    fs.writeFileSync(file, torn, { mode: 0o600 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const outbox = createFileTelemetryOutbox(file);
      expect(await outbox.take(10)).toEqual([]);
      expect(warn).toHaveBeenCalledWith('[telemetry] outbox unreadable: kept aside, starting a new queue');
      expect(warn.mock.calls.flat().join(' ')).not.toContain(dir);
      expect(fs.readFileSync(unreadableOutboxFile(file), 'utf8')).toBe(torn);

      await outbox.append(envelope);
      expect(fs.readFileSync(unreadableOutboxFile(file), 'utf8')).toBe(torn);
      expect(await createFileTelemetryOutbox(file).take(10)).toEqual([{ id: 1, envelope }]);

      await outbox.clear();
      expect(fs.existsSync(unreadableOutboxFile(file))).toBe(false);
      expect(await createFileTelemetryOutbox(file).take(10)).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('starts empty without a file and leaves nothing aside', async () => {
    const file = telemetryOutboxFile(dir);
    expect(await createFileTelemetryOutbox(file).take(10)).toEqual([]);
    expect(fs.existsSync(unreadableOutboxFile(file))).toBe(false);
  });
});
