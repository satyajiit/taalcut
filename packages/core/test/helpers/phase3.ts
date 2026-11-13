// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Phase 3 contract fixtures: a Style, a look, and a hub template made from the reference template. */
import {
  connectRpc,
  FrameRates,
  newId,
  RationalTime,
  serveRpc,
  type AnyContractRouter,
  type HubTemplateV0,
  type LookStats,
  type RpcClient,
  type RpcRouter,
  type Style,
  type StyleInput,
} from '@taalcut/core';
import type { z } from 'zod';
import { referenceTemplate, SHA, T0 } from './documents';
import { channel } from './ports';

/** A router served over a port pair, and a client for it: what a window gets. */
export function serve<C extends AnyContractRouter>(
  contract: C,
  router: RpcRouter<C, Record<never, never>>,
): RpcClient<C> {
  const { port1, port2 } = channel();
  serveRpc(router, port1, { context: {} });
  return connectRpc(contract, port2, { peer: 'agent' }).client;
}

interface Procedure {
  readonly '~orpc': { readonly inputSchema?: unknown; readonly outputSchema?: unknown };
}

/** A procedure's input schema applied to a value (what the server checks before its handler runs). */
export function inputOf(procedure: Procedure, value: unknown) {
  return (procedure['~orpc'].inputSchema as z.ZodType).safeParse(value);
}

/** A procedure's output schema applied to a value. */
export function outputOf(procedure: Procedure, value: unknown) {
  return (procedure['~orpc'].outputSchema as z.ZodType).safeParse(value);
}

export const look = (): LookStats => ({
  version: 1,
  space: 'ruderman-lab',
  encoding: 'bt709',
  mean: [0.1, -0.02, 0.03],
  std: [0.4, 0.05, 0.06],
  frames: 12,
  pixels: 1_000_000,
});

export function styleInput(): StyleInput {
  const heading = { family: 'poppins' as const, weight: 700 };
  return {
    name: 'Goa kit',
    kind: 'brandKit',
    colours: {
      primary: '#112233',
      secondary: '#445566',
      accent: '#ff8800',
      text: '#ffffff',
      background: '#000000',
    },
    fonts: { heading, body: { family: 'notoSans', weight: 400 } },
    captions: null,
    textStyles: { title: { font: heading, colour: '#ffffff', background: null, stroke: null } },
    logo: {
      asset: SHA,
      mediaType: 'image/png',
      width: 512,
      height: 512,
      placement: 'topRight',
      scale: 0.12,
      opacity: 0.9,
      showOn: 'always',
    },
    watermark: { kind: 'logo', placement: 'bottomRight', opacity: 0.3 },
    intro: {
      kind: 'card',
      text: 'Goa',
      duration: RationalTime.of(60, FrameRates.fps30),
      background: 'primary',
    },
    outro: null,
    grade: null,
    fontMatch: null,
    madeFrom: null,
  };
}

export function style(): Style {
  return {
    schemaVersion: 1,
    id: newId<'Style'>(),
    revision: 1,
    ...styleInput(),
    createdAt: T0,
    updatedAt: T0,
  };
}

/** The reference template as the hub would hold it: structure only, a placeholder for its words. */
export function hubTemplate(): HubTemplateV0 {
  const template = referenceTemplate();
  return {
    format: 'taalcut.template',
    formatVersion: 0,
    licence: 'CC0-1.0',
    id: newId<'HubTemplate'>(),
    version: 1,
    name: 'Day one',
    description: 'Three cuts on the beat.',
    handle: 'kaatu.cuts',
    language: 'en',
    tags: ['travel'],
    formatId: null,
    trendFreshness: '2026-10-01',
    forkedFrom: null,
    structure: {
      canvas: template.canvas,
      duration: template.duration,
      slots: template.slots.map((slot) => ({
        role: slot.role,
        name: slot.name,
        start: slot.start,
        duration: slot.duration,
        intent: {
          text: slot.intent.text,
          shotType: slot.intent.shotType,
          motion: slot.intent.motion,
          subject: slot.intent.subject,
          people: slot.intent.people,
          place: slot.intent.place,
          energy: slot.intent.energy,
        },
        beatAnchor: slot.beatAnchor,
        transitionIn: slot.transitionIn,
        speedRamp: slot.speedRamp,
      })),
      beatMap: template.beatMap,
      text: template.text.map((overlay) => ({
        role: overlay.role,
        start: overlay.start,
        duration: overlay.duration,
        slotIndex: 0,
        box: overlay.box,
        appearance: overlay.appearance,
        styleKey: overlay.styleKey,
        reveal: overlay.reveal,
        language: overlay.language,
        placeholder: '{title}',
        words: 3,
        chars: 12,
      })),
      audio: { kind: 'music', loudnessLufs: -14, speechCoverage: null, speechLanguage: null },
      pacing: template.pacing,
    },
    style: null,
  };
}
