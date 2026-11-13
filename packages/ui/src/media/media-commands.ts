// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The commands the media cards dispatch (P3-B6, P3-V13, P3-B7). The kit imports no runtime code from core, so each
 * name is a typed literal: a renamed command in core fails the build here.
 */
import type {
  DuckingSettings,
  GRAPHICS_COMMANDS,
  MIX_COMMANDS,
  TIMELINE_COMMANDS,
  VOICE_COMMANDS,
  VOICE_CONSENT_COMMANDS,
} from '@taalcut/core';

export const REMOVE_VOICEOVER: (typeof VOICE_COMMANDS)['removeVoiceover'] = 'voice.removeVoiceover';
export const SET_DUCKING: (typeof MIX_COMMANDS)['setDucking'] = 'music.setDucking';
export const EDIT_GRAPHIC: (typeof GRAPHICS_COMMANDS)['edit'] = 'graphics.edit';
export const REMOVE_GRAPHIC: (typeof GRAPHICS_COMMANDS)['remove'] = 'graphics.remove';
export const USE_PROPOSAL: (typeof GRAPHICS_COMMANDS)['useProposal'] = 'graphics.useProposal';
export const SWAP_CLIP: (typeof TIMELINE_COMMANDS)['swapClip'] = 'timeline.swapClip';
export const FILL_GAP: (typeof TIMELINE_COMMANDS)['fillGap'] = 'timeline.fillGap';
export const RECORD_CONSENT: (typeof VOICE_CONSENT_COMMANDS)['recordConsent'] = 'voice.recordConsent';
export const WITHDRAW_CONSENT: (typeof VOICE_CONSENT_COMMANDS)['withdrawConsent'] = 'voice.withdrawConsent';
export const CREATE_CLONE: (typeof VOICE_CONSENT_COMMANDS)['createClone'] = 'voice.createClone';

/** music.setDucking's margin, voice above music in LU (core's duckingSettingsSchema: 6 to 20). */
export const DUCKING_MARGIN = { min: 6, max: 20 } as const satisfies Record<
  string,
  DuckingSettings['marginLu']
>;

/** A consent recording is 60 s to 10 minutes (audio's consent steps; main's capture refuses longer). */
export const CONSENT_RECORDING_MS = { min: 60_000, max: 600_000 } as const;

/** voice.createClone's name, 1 to 60 characters (core's payload). */
export const VOICE_NAME_MAX = 60;
/** voice.recordConsent's speaker name, 1 to 80 characters. */
export const SPEAKER_NAME_MAX = 80;
