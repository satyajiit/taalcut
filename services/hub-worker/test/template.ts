// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { hubIdSchema, type HubTemplateV0 } from '@taalcut/core/hub';

export const HUB_ID = hubIdSchema.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
/** A valid ULID with a nine-digit run: the phone rule must not fire on an id (contract round P3-2). */
export const DIGIT_HUB_ID = hubIdSchema.parse('01ARZ3NDEK0123456789ABCDEF');
export const OTHER_HUB_ID = hubIdSchema.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW');
export const INSTALL_A = 'aaaaaaaaaaaaaaaaaaaaaa';
export const INSTALL_B = 'bbbbbbbbbbbbbbbbbbbbbb';

type HubTime = HubTemplateV0['structure']['duration'];

/** Thirtieths of a second; the rate is reduced, as hubTimeSchema requires. */
function time(value: number): HubTime {
  return { value, rate: { num: 30, den: 1 } };
}

function slot(
  role: 'hook' | 'body' | 'outro',
  name: string,
  start: number,
  duration: number,
  energy: number,
): HubTemplateV0['structure']['slots'][number] {
  return {
    role,
    name,
    start: time(start),
    duration: time(duration),
    intent: {
      text: `${name} shot of a quiet street`,
      shotType: 'wide',
      motion: 'static',
      subject: 'street',
      people: 0,
      place: 'city',
      energy,
    },
    beatAnchor: null,
    transitionIn: null,
    speedRamp: null,
  };
}

export function makeTemplate(id: string = HUB_ID): HubTemplateV0 {
  return {
    format: 'taalcut.template',
    formatVersion: 0,
    licence: 'CC0-1.0',
    id: hubIdSchema.parse(id),
    version: 1,
    name: 'Weekend trip',
    description: 'A short vlog structure',
    handle: 'ada',
    language: 'en',
    tags: ['vlog'],
    formatId: 'vlog',
    trendFreshness: null,
    forkedFrom: null,
    structure: {
      canvas: { width: 1080, height: 1920, rate: { num: 30, den: 1 } },
      duration: time(90),
      slots: [
        slot('hook', 'Open', 0, 30, 0.4),
        slot('body', 'Walk', 30, 45, 0.6),
        slot('outro', 'End', 75, 15, 0.3),
      ],
      beatMap: null,
      text: [],
      audio: { kind: 'music', loudnessLufs: -14, speechCoverage: 0, speechLanguage: null },
      pacing: {
        shotCount: 3,
        meanShot: time(30),
        medianShot: time(30),
        shortestShot: time(15),
        longestShot: time(45),
        hookEnd: time(30),
        cutsOnBeat: null,
      },
    },
    style: null,
  };
}
