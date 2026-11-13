// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-I3: the listening runner, and `eval` without the golden set's flags. Without models or a labelled set the
 * model suites skip and the run exits 0; a suite below its bar or one that throws exits 1.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/cli';
import { listenModelsHere } from '../../src/listening/environment';
import { outcomeOf } from '../../src/listening/outcome';
import { runListening, type ListenSuiteRun } from '../../src/listening/run';
import { moodManifestPath } from '../../src/listen-pick/mood/suite';

const tmp = () => mkdtempSync(join(tmpdir(), 'taalcut-listen-test-'));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the listening runner', () => {
  it('writes a report per suite and a summary; a throw is a failure, the next suite still runs', async () => {
    const out = tmp();
    const passing: ListenSuiteRun = async () =>
      outcomeOf('listen-pick', {
        metrics: [{ name: 'top5FamilyRate', value: 0.95, better: 'higher', part: 'queries' }],
        seconds: 0,
      });
    const throwing: ListenSuiteRun = async () => {
      throw new Error('no fixtures');
    };
    const lines: string[] = [];
    const outcomes = await runListening(['listen-pick', 'listen-parity'], out, {
      suites: {
        'listen-pick': passing,
        'listen-parity': throwing,
        'listen-breakdown-hits': passing,
        'listen-mood': passing,
      },
      log: (line) => lines.push(line),
    });
    expect(outcomes.map((o) => o.status)).toEqual(['pass', 'fail']);
    expect(lines[1]).toMatch(/^listen-parity: fail\. error: no fixtures/);
    const pick = JSON.parse(readFileSync(join(out, 'listen-pick', 'report.json'), 'utf8')) as {
      metrics: unknown[];
      claimed: boolean;
    };
    expect(pick).toMatchObject({ claimed: true, metrics: [{ name: 'top5FamilyRate', value: 0.95 }] });
    expect(readFileSync(join(out, 'listen-pick', 'report.md'), 'utf8')).toContain(
      '| queries | top5FamilyRate |',
    );
    expect(readFileSync(join(out, 'summary.md'), 'utf8')).toContain(
      '| listen-parity | EAR1-F5, EAR1-F6, EAR1-A1 | fail |',
    );
  });

  it('`eval` with no golden set skips the model suites cleanly without models or a labelled set', async () => {
    vi.stubEnv('TAALCUT_EAR1_MODELS', '');
    vi.stubEnv('TAALCUT_LISTEN_MOOD_MANIFEST', join(tmp(), 'none.json'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const out = tmp();
    expect(await main(['--', '--suite', 'listen-pick', '--suite', 'listen-mood', '--out', out])).toBe(0);
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')) as {
      status: string;
      claimed: boolean;
    }[];
    expect(summary.map((s) => [s.status, s.claimed])).toEqual([
      ['skipped', false],
      ['skipped', false],
    ]);
    expect(readFileSync(join(out, 'listen-mood', 'report.md'), 'utf8')).toContain('no labelled set');
    expect(readFileSync(join(out, 'listen-pick', 'report.md'), 'utf8')).toContain(
      'TAALCUT_EAR1_MODELS is not set',
    );
  });

  it('refuses an unknown suite', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['--suite', 'listen-everything'])).toBe(1);
    expect(error.mock.calls[0]?.[0]).toMatch(/Unknown listening suite: listen-everything/);
  });
});

describe('what the listening suites need', () => {
  it('names the model that is missing, and finds a folder of unpacked builds in the dtype asked for', async () => {
    const root = tmp();
    expect(await listenModelsHere(['clapAudio'], {})).toEqual({
      reason: 'no listen models: TAALCUT_EAR1_MODELS is not set',
    });
    expect(await listenModelsHere(['clapAudio'], { TAALCUT_EAR1_MODELS: root })).toEqual({
      reason: `no fp16 clapAudio model under ${root} (TAALCUT_EAR1_MODELS)`,
    });
    for (const id of ['clap-general-audio-fp16', 'clap-general-text']) {
      mkdirSync(join(root, id));
      writeFileSync(join(root, id, 'model.onnx'), '');
    }
    expect(await listenModelsHere(['clapAudio'], { TAALCUT_EAR1_MODELS: root })).toEqual({
      found: { root, dtype: 'fp16' },
    });
    const int8 = { TAALCUT_EAR1_MODELS: root, TAALCUT_LISTEN_DTYPE: 'int8' };
    expect(await listenModelsHere(['clapText'], int8)).toEqual({ found: { root, dtype: 'int8' } });
    expect(await listenModelsHere(['clapText', 'ast'], int8)).toEqual({
      reason: `no int8 ast model under ${root} (TAALCUT_EAR1_MODELS)`,
    });
  });

  it('looks for the mood set where the owner puts it', () => {
    expect(moodManifestPath({})).toMatch(/tools\/evals\/golden\/listen-mood\/manifest\.json$/);
    expect(moodManifestPath({ TAALCUT_LISTEN_MOOD_MANIFEST: '/sets/mood.json' })).toBe('/sets/mood.json');
  });
});
