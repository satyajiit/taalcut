// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap } from '@taalcut/core';
import type { JsonLineSidecar } from '@taalcut/media';
import { WARMUP_CAP_MS } from '../../../src/ocr/apple-vision-wire';
import type { OcrEngine, OcrWarmReport } from '../../../src/ocr/types';

export const OCR_READY_TIMEOUT_MS = 60_000;
// Model compilation belongs to fixture setup, with the same finite cap as the production warm-up contract.
export const OCR_SETUP_TIMEOUT_MS = OCR_READY_TIMEOUT_MS + WARMUP_CAP_MS;

/** Functional timing starts only after the real helper has compiled and read its warm-up canvases. */
export async function prepareOcrFixture(sidecar: JsonLineSidecar, ocr: OcrEngine): Promise<OcrWarmReport> {
  unwrap(await sidecar.ready());
  if (!ocr.warm) throw new Error('OCR fixture requires the helper warm-up contract');
  const report = unwrap(await ocr.warm());
  if (!report || !report.steps.some((step) => step.script === 'latin'))
    throw new Error('OCR fixture warm-up did not read its base canvas');
  const failures = report.steps.filter((step) => step.error);
  if (failures.length)
    throw new Error(
      `OCR fixture warm-up failed: ${failures.map((step) => `${step.script}: ${step.error}`).join(', ')}`,
    );
  return report;
}
