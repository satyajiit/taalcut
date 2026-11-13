// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { MICROPHONE_PERMISSIONS } from '@taalcut/core';
import type { AreaOptionsReader } from './area-options';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isPermission = (value: unknown): value is (typeof MICROPHONE_PERMISSIONS)[number] =>
  (MICROPHONE_PERMISSIONS as readonly unknown[]).includes(value);

/**
 * The media area's fake options from `taalcut.fake` (P3-B6, P3-V13, P3-B7):
 * `media: { microphone, answer, arranged, heard }`. `microphone` is the macOS permission the fake reports
 * ('granted', 'denied', 'not-determined', 'restricted'); `answer` what the person says when asked ('granted' or
 * 'denied'); `arranged` puts the media cards' voiceovers, graphics and image slots on the Golden hour timelines;
 * `heard` is what the consent check hears instead of the line (a mismatch); `designs` (HFW1-UI) puts graphics the AI
 * designed on Golden hour's first video in place of the kit's, and seeds its workspace.
 */
export const mediaOptions: AreaOptionsReader = (stored) => {
  const media = stored['media'];
  if (!isRecord(media)) return {};
  const answer = media['answer'];
  return {
    phase3: {
      voiceCapture: {
        ...(isPermission(media['microphone']) ? { permission: media['microphone'] } : {}),
        ...(answer === 'granted' || answer === 'denied' ? { answer } : {}),
        ...(media['arranged'] === true ? { arranged: true } : {}),
        ...(typeof media['heard'] === 'string' ? { heard: media['heard'].slice(0, 300) } : {}),
      },
      ...(media['designs'] === true ? { designs: { arranged: true } } : {}),
    },
  };
};
