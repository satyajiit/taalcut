// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CancelledError, err, ok, type Result } from '@taalcut/core';
import type { JsonLineSidecar, JsonValue } from '@taalcut/media';
import { expect, it, vi } from 'vitest';
import type { OcrEngine, OcrWarmReport } from '../../src/ocr/types';
import { prepareOcrFixture } from './helpers/fixture-startup';

const report: OcrWarmReport = { steps: [{ script: 'latin', ms: 1 }], ms: 1, yieldedMs: 0 };
const sidecar = (): JsonLineSidecar => ({
  ready: vi.fn(async () => ok({})),
  request: vi.fn(async () => ok({})),
  close: vi.fn(async () => {}),
});
const engine = (): OcrEngine => ({
  capabilities: vi.fn(async () => ok({ scripts: [], languages: [] })),
  recognize: vi.fn(async () => ok([])),
  warm: vi.fn(async () => ok(report)),
});

it('does not finish setup before both ready and actual warm-up replies arrive', async () => {
  const ready = Promise.withResolvers<Result<JsonValue>>();
  const warm = Promise.withResolvers<Result<OcrWarmReport | null>>();
  const helper = sidecar();
  helper.ready = vi.fn(() => ready.promise);
  const ocr = engine();
  ocr.warm = vi.fn(() => warm.promise);
  const complete = vi.fn();
  const setup = prepareOcrFixture(helper, ocr).then(complete);
  expect(ocr.warm).not.toHaveBeenCalled();
  ready.resolve(ok({}));
  await vi.waitFor(() => expect(ocr.warm).toHaveBeenCalledOnce());
  expect(complete).not.toHaveBeenCalled();
  warm.resolve(ok(report));
  await setup;
  expect(complete).toHaveBeenCalledWith(report);
  expect(ocr.recognize).not.toHaveBeenCalled();
});

it('fails fixture setup when the helper cannot become ready', async () => {
  const helper = sidecar();
  helper.ready = vi.fn(async () => err(CancelledError()));
  const ocr = engine();
  await expect(prepareOcrFixture(helper, ocr)).rejects.toBeDefined();
  expect(ocr.warm).not.toHaveBeenCalled();
});

it.each([
  null,
  { ...report, steps: [] },
  { ...report, steps: [{ script: 'latin', ms: 1, error: 'ocr.failed' }] },
])('fails setup without successful model preparation: %j', async (value) => {
  const ocr = engine();
  ocr.warm = async () => ok(value);
  await expect(prepareOcrFixture(sidecar(), ocr)).rejects.toThrow('OCR fixture warm-up');
});
