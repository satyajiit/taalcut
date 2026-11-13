// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Every Phase 3 QA module, in report order. A new check is a new module and one line here. */
import { brandQaModule } from './brand';
import { credentialsQaModule } from './credentials';
import { facesQaModule } from './faces';
import { graphicsQaModule } from './graphics';
import type { QaCheckModule } from './module';
import { reframeQaModule } from './reframe';
import { slotMatchQaModule } from './slot-match';
import { soundListeningQaModule } from './sound-listening';
import { stylePacingQaModule } from './style-pacing';
import { voiceOverMusicQaModule } from './voice-over-music';

export const QA_MODULES: readonly QaCheckModule[] = [
  reframeQaModule,
  graphicsQaModule,
  voiceOverMusicQaModule,
  credentialsQaModule,
  brandQaModule,
  // LRN1-STY.
  stylePacingQaModule,
  // FRM1-OVL: every graphic and text item clear of heads, reframed or not.
  facesQaModule,
  // AGT2-MATCH: the draft against its template, slot by slot.
  slotMatchQaModule,
  // EAR1-A2: the render heard: a sound on each planned cut, a clean mix, the sound critique (warns only).
  soundListeningQaModule,
];

export type { ProbedFrames, QaCheckModule, QaModuleInput } from './module';
export type { HeardCut, PlannedEffect, QaFacts, SoundListeningFact } from './facts';
