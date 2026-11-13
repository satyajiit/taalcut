// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { transferFileSchema, type TransferFile } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { QUIET, transferCue, type TransferSoundState } from '../../src/features/sounds/transfer-sounds';

const file = (n: number, state: TransferFile['state']): TransferFile =>
  transferFileSchema.parse({
    id: `01K7C5M6Q8PH0NE00000000F0${n}`,
    sessionId: '01K7C5M6Q8SESS10N000000001',
    deviceId: '01K7C5M6Q8PH0NE00000000D01',
    name: `IMG_88${n}0.MOV`,
    sizeBytes: 1000,
    receivedBytes: 1000,
    state,
    updatedAt: 0,
  });

function cues(...steps: TransferFile[][]): (string | null)[] {
  let state: TransferSoundState = QUIET;
  return steps.map((files) => {
    const next = transferCue(state, files);
    state = next.state;
    return next.cue;
  });
}

describe('transfer cues', () => {
  it('waits until an observed upload has been imported', () => {
    expect(
      cues([file(1, 'uploading')], [file(1, 'checking')], [file(1, 'importing')], [file(1, 'imported')]),
    ).toEqual([null, null, null, 'importDone']);
  });

  it('plays once when the whole batch settles, with no per-file pings or duplicate snapshot cue', () => {
    expect(
      cues(
        [file(1, 'uploading'), file(2, 'uploading'), file(3, 'uploading')],
        [file(1, 'imported'), file(2, 'uploading'), file(3, 'uploading')],
        [file(1, 'imported'), file(2, 'imported'), file(3, 'importing')],
        [file(1, 'imported'), file(2, 'imported'), file(3, 'imported')],
        [file(1, 'imported'), file(2, 'imported'), file(3, 'imported')],
      ),
    ).toEqual([null, null, null, 'importDone', null]);
  });

  it('does not announce historical imports or duplicate-only batches', () => {
    expect(cues([file(1, 'imported')], [file(1, 'imported')])).toEqual([null, null]);
    expect(cues([file(1, 'uploading')], [file(1, 'duplicate')])).toEqual([null, null]);
  });

  it.each(['failed', 'rejected', 'cancelled'] as const)('keeps a partially %s batch silent', (terminal) => {
    expect(
      cues(
        [file(1, 'uploading'), file(2, 'uploading')],
        [file(1, 'imported'), file(2, 'uploading')],
        [file(1, 'imported'), file(2, terminal)],
      ),
    ).toEqual([null, null, null]);
  });

  it('remembers an early failure until the rest of the batch settles', () => {
    expect(
      cues(
        [file(1, 'uploading'), file(2, 'uploading')],
        [file(1, 'failed'), file(2, 'importing')],
        [file(1, 'failed'), file(2, 'imported')],
      ),
    ).toEqual([null, null, null]);
  });

  it('keeps paused work open until its successful completion', () => {
    expect(
      cues(
        [file(1, 'uploading'), file(2, 'uploading')],
        [file(1, 'imported'), file(2, 'paused')],
        [file(1, 'imported'), file(2, 'importing')],
        [file(1, 'imported'), file(2, 'imported')],
      ),
    ).toEqual([null, null, null, 'importDone']);
  });

  it('starts a later batch afresh after a failure', () => {
    expect(
      cues(
        [file(1, 'uploading')],
        [file(1, 'failed')],
        [file(1, 'failed'), file(2, 'uploading')],
        [file(1, 'failed'), file(2, 'imported')],
      ),
    ).toEqual([null, null, null, 'importDone']);
  });
});
