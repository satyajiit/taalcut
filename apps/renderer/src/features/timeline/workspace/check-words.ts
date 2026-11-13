// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: the checks a design passed before it went on the timeline (render's gate: its ids are render's, an open
 * list), in the editor's words: what each one looks at, never the gate's own names. An id the app doesn't know yet
 * is "Another check". Each check's detail is the gate's words for the model: shown as written, as data.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { CompositionGateCheck } from '@taalcut/core';

export const CHECK_WORDS: Readonly<Record<string, MessageDescriptor>> = {
  hfLint: msg`The files are well formed`,
  markup: msg`Only the parts a graphic may use`,
  css: msg`Only the styles a graphic may use`,
  urls: msg`Pictures come from its own files`,
  limits: msg`Small enough to play smoothly`,
  lowering: msg`Its motion plays in Taalcut`,
  bounds: msg`Stays on screen`,
  safe: msg`Clear of the app’s buttons`,
  contrast: msg`Easy to read`,
  type: msg`Text big enough to read`,
  faces: msg`Clear of faces`,
  determinism: msg`Plays the same every time`,
};

export const OTHER_CHECK = msg`Another check`;

export const CHECK_STATUS_WORDS: Readonly<Record<CompositionGateCheck['status'], MessageDescriptor>> = {
  pass: msg`Passed`,
  repaired: msg`Fixed`,
  fail: msg`Didn’t pass`,
  skipped: msg`Not checked`,
};
