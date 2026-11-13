// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export const HUB_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const rate = { num: 30, den: 1 };

function time(value: number): { value: number; rate: { num: number; den: number } } {
  return { value, rate: { num: rate.num, den: rate.den } };
}

export function template(patch?: { id?: string; version?: number; handle?: string; description?: string }): Record<string, unknown> {
  const id = patch?.id ?? HUB_ID;
  const slot = (role: string, name: string, start: number, duration: number, energy: number) => ({
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
  });
  return {
    format: 'taalcut.template',
    formatVersion: 0,
    licence: 'CC0-1.0',
    id,
    version: patch?.version ?? 1,
    name: 'Weekend trip',
    description: patch?.description ?? 'A short vlog structure',
    handle: patch?.handle ?? 'ada',
    language: 'en',
    tags: ['vlog'],
    formatId: 'vlog',
    trendFreshness: null,
    forkedFrom: null,
    structure: {
      canvas: { width: 1080, height: 1920, rate: { ...rate } },
      duration: time(90),
      slots: [slot('hook', 'Open', 0, 30, 0.4), slot('body', 'Walk', 30, 45, 0.6), slot('outro', 'End', 75, 15, 0.3)],
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

export function templateRel(id: string = HUB_ID): string {
  return `templates/${id.slice(0, 2)}/${id}.json`;
}
