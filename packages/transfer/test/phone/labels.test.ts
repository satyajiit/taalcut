// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error phone modules ship as plain JavaScript for the browser.
import { failureLabelKey, serverFailureLabel, stateLabelKey } from '../../phone/logic.mjs';

const en = JSON.parse(readFileSync(new URL('../../phone/locales/en.json', import.meta.url), 'utf8')) as Record<
  string,
  string
>;

const STATES: ReadonlyArray<readonly [string, string]> = [
  ['waiting', 'state.waiting'],
  ['sending', 'state.sending'],
  ['uploading', 'state.sending'],
  ['paused', 'state.paused'],
  ['held', 'state.held'],
  ['received', 'state.received'],
  ['checking', 'state.adding'],
  ['importing', 'state.adding'],
  ['added', 'state.added'],
  ['imported', 'state.added'],
  ['duplicate', 'state.already'],
  ['smaller-copy', 'state.smallerCopy'],
  ['likely', 'state.smallerCopy'],
  ['failed', 'state.failed'],
  ['rejected', 'state.rejected'],
  ['cancelled', 'state.cancelled'],
  ['ghost', 'state.ghost'],
  ['something-else', 'state.unknown'],
];

describe('stateLabelKey', () => {
  it('maps every upload state to a key in the English catalog', () => {
    for (const [state, key] of STATES) {
      expect(stateLabelKey(state)).toBe(key);
      expect(en[key]?.length, key).toBeGreaterThan(0);
    }
  });

  it('keeps state words short (a status line) and puts the sentences in the reasons', () => {
    expect(en[stateLabelKey('paused')]).toBe('Connection lost');
    expect(en['reason.paused']).toBe('It carries on by itself when the connection is back.');
    expect(en[stateLabelKey('imported')]).toBe('Added');
    expect(en[stateLabelKey('duplicate')]).toBe('Already on your Mac');
    expect(en[stateLabelKey('likely')]).toBe(
      'Your phone sent a smaller copy of this video. For the original, choose it from the Files app.',
    );
    for (const [state] of STATES.filter(([state]) => !['likely', 'smaller-copy'].includes(state))) {
      expect(en[stateLabelKey(state)]?.length, state).toBeLessThanOrEqual(24);
    }
  });
});

describe('why a file was refused', () => {
  it('names the reason for each refusal the Mac can give, over HTTP or in its file list', () => {
    expect(failureLabelKey(413)).toBe('error.tooLarge');
    expect(failureLabelKey(415)).toBe('error.notMedia');
    expect(failureLabelKey(507)).toBe('error.diskFull');
    expect(failureLabelKey(403)).toBe('error.forbidden');
    expect(failureLabelKey(0)).toBe('error.network');
    expect(failureLabelKey(500)).toBe('error.generic');
    expect(serverFailureLabel({ code: 'transfer.not_media' })).toBe('error.notMedia');
    expect(serverFailureLabel({ code: 'transfer.too_large' })).toBe('error.tooLarge');
    expect(serverFailureLabel({ code: 'transfer.disk_full' })).toBe('error.diskFull');
    expect(serverFailureLabel({ code: 'transfer.import_failed' })).toBe('error.importFailed');
    expect(serverFailureLabel({ code: 'transfer.something_new' })).toBe('');
    expect(serverFailureLabel(null)).toBe('');
  });
});
