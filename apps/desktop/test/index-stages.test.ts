// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's stage list (P2-L13): every package's stages in the
 * library SPEC's order, vision's near-duplicate pass, and where shot
 * descriptions run (on this Mac unless vision has a standing upload consent
 * and local-only mode is off). The jobs root registers the full set.
 */
import { describe, expect, it } from 'vitest';
import {
  LOCAL_ONLY_SETTING,
  newId,
  ok,
  UPLOAD_CONSENTS_SETTING,
  type AssetIndexView,
  type SettingsStore,
} from '@taalcut/core';
import { MODEL_MISSING } from '@taalcut/library';
import { composeJobs } from '../src/utility/roots/jobs-root';
import {
  indexStageWiring,
  IndexStagesToken,
  ocrComponentOf,
  screenLanguages,
} from '../src/utility/roots/index-stages';
import { testConfig } from './helpers/roots';

function settings(values: Record<string, unknown>): SettingsStore {
  return {
    get: async (setting: { key: string; defaultValue: unknown }) =>
      ok(values[setting.key] ?? setting.defaultValue),
  } as unknown as SettingsStore;
}

const STAGES = [
  'library.hash',
  'media.normalise',
  'media.thumbnail',
  'media.proxy',
  'media.filmstrip',
  'media.previews',
  'library.place',
  'vision.shots',
  'vision.analyse',
  'vision.ocr',
  'vision.embedOcr',
  'vision.embed',
  'vision.embedText',
  'vision.contactSheet',
  'vision.describe',
  'audio.language',
  'audio.transcript',
  'audio.beats',
];

function analysedView(): AssetIndexView {
  const rate = { num: 30, den: 1 };
  return {
    assetId: newId<'Asset'>(),
    generation: 1,
    kind: 'video',
    path: '/a.mov',
    contentHash: 'ab'.repeat(32),
    sizeBytes: 1,
    sourceId: newId<'Source'>(),
    capturedAt: null,
    facts: null,
    derived: [],
    shots: [
      {
        shotId: newId<'Shot'>(),
        range: { start: { value: 0, rate }, duration: { value: 60, rate } },
        analysis: { bestFrame: 3 } as never,
      },
    ],
    transcript: null,
    outputs: {},
  };
}

describe('index stages in the jobs process', () => {
  it('lists every package stage and the duplicates pass', () => {
    const wiring = indexStageWiring({ tier: async () => 'high', settings: () => settings({}) });
    expect(wiring.stages.map((s) => s.stage)).toEqual(STAGES);
    expect(wiring.duplicates?.after).toEqual(['vision.analyse']);
  });

  it('describes shots on this Mac unless vision has a standing consent and local-only is off', async () => {
    const consent = { vision: { id: 'c1', module: 'vision', providers: ['openai'], grantedAt: 1 } };
    const kindFor = async (values: Record<string, unknown>) => {
      const wiring = indexStageWiring({ tier: async () => 'recommended', settings: () => settings(values) });
      await wiring.refresh();
      const describe = wiring.stages.find((s) => s.stage === 'vision.describe')!;
      const job = describe.job(analysedView());
      return 'kind' in job ? job.kind.kind : job.skip;
    };
    expect(await kindFor({})).toBe('vision.describeShots');
    expect(await kindFor({ [UPLOAD_CONSENTS_SETTING.key]: consent })).toBe('vision.describeShotsCloud');
    expect(await kindFor({ [UPLOAD_CONSENTS_SETTING.key]: consent, [LOCAL_ONLY_SETTING.key]: true })).toBe(
      'vision.describeShots',
    );
  });

  it('keeps every stage that writes embedding vectors waiting until its model is installed, descriptions too', async () => {
    const installed = new Set<string>();
    const wiring = (packaged: boolean) =>
      indexStageWiring({
        tier: async () => 'recommended',
        settings: () => settings({}),
        installed: (id) => installed.has(id),
        managedRuntimes: packaged,
      });
    const app = wiring(true);
    await app.refresh();
    expect(app.notReady?.('vision.embed')).toBe(MODEL_MISSING);
    expect(app.notReady?.('vision.embedText')).toBe(MODEL_MISSING);
    expect(app.notReady?.('vision.embedOcr')).toBe(MODEL_MISSING);
    // IX-F1: a cloud description stores its vectors in the same job; without the model it would upload, then fail.
    expect(app.notReady?.('vision.describe')).toBe(MODEL_MISSING);
    expect(app.notReady?.('vision.analyse')).toBeUndefined();
    expect(app.notReady?.('vision.ocr')).toBeUndefined();
    installed.add('embeddinggemma-2');
    await app.refresh();
    expect(app.notReady?.('vision.embed')).toBe(MODEL_MISSING); // a packaged app needs the ONNX Runtime too
    installed.add('onnxruntime');
    await app.refresh();
    expect(app.notReady?.('vision.embed')).toBeUndefined();
    expect(app.notReady?.('vision.embedText')).toBeUndefined();
    expect(app.notReady?.('vision.embedOcr')).toBeUndefined();
    // On this Mac a description also waits for the model that describes (describe-wait.test.ts).
    expect(app.notReady?.('vision.describe')).toBe(MODEL_MISSING);
    // A checkout loads ONNX Runtime from node_modules; without an installed-check nothing waits.
    installed.delete('onnxruntime');
    const checkout = wiring(false);
    await checkout.refresh();
    expect(checkout.notReady?.('vision.embed')).toBeUndefined();
    const bare = indexStageWiring({ tier: async () => 'high', settings: () => settings({}) });
    await bare.refresh();
    expect(bare.notReady?.('vision.embed')).toBeUndefined();
  });

  it('keeps OCR waiting for its PP-OCR model where there is no Apple Vision; a Mac never waits (UX3-IDX)', async () => {
    const installed = new Set<string>();
    expect(ocrComponentOf('darwin')).toEqual({});
    expect(ocrComponentOf('linux')).toEqual({ ocrComponent: 'ppocr-v5-latin' });
    const wiring = (platform: NodeJS.Platform, packaged: boolean) =>
      indexStageWiring({
        tier: async () => 'recommended',
        settings: () => settings({}),
        installed: (id) => installed.has(id),
        managedRuntimes: packaged,
        ...ocrComponentOf(platform),
      });
    const linux = wiring('linux', true);
    const mac = wiring('darwin', true);
    await Promise.all([linux.refresh(), mac.refresh()]);
    expect(linux.notReady?.('vision.ocr')).toBe(MODEL_MISSING);
    expect(mac.notReady?.('vision.ocr')).toBeUndefined();
    installed.add('ppocr-v5-latin');
    await linux.refresh();
    expect(linux.notReady?.('vision.ocr')).toBe(MODEL_MISSING); // and ONNX Runtime under it
    installed.add('onnxruntime');
    await linux.refresh();
    expect(linux.notReady?.('vision.ocr')).toBeUndefined();
  });

  it('reads on screen in the Mac language when it is a v1 language, and in English', () => {
    expect(screenLanguages('hi-IN')).toEqual(['hi', 'en']);
    expect(screenLanguages('pt-BR')).toEqual(['pt-BR', 'en']);
    expect(screenLanguages('en-GB')).toEqual(['en']);
    expect(screenLanguages('fr-FR')).toEqual(['en']);
  });

  it('is registered by the jobs root with its real kinds, and stopped with the container', async () => {
    const root = composeJobs(testConfig('jobs'), { pid: 1 });
    expect(root.container.has(IndexStagesToken)).toBe(true);
    expect(root.container.resolve(IndexStagesToken).stages.map((s) => s.stage)).toEqual(STAGES);
    await root.container.dispose();
  });
});
