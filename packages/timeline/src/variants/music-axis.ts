// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The music axis (P3-V3): variant k takes the first candidate the base and no earlier variant uses, as
 * `music.choosePath` would set it (resync/music-beats.ts): an own track with a beat map re-times the cuts to its
 * beats, and the reel's own music puts them back on the reel's. Since REF1 the reel's music needs no acknowledgement;
 * a reel candidate counts only when it is the base's own template's, whose beat map the cuts are on.
 */
import { isDeepStrictEqual } from 'node:util';
import { ok, type AsyncResult, type MusicChoice, type Timeline } from '@taalcut/core';
import { withMusic } from '../resync/music-beats';
import type { AxisInput, VariantAxis, VariantContext } from './axis';

/** A candidate this base can take: anything but another template's reel. */
const fits = (base: Timeline) => (candidate: MusicChoice) =>
  candidate.path !== 'referenceAudio' || candidate.templateId === base.template?.id;

async function vary({ base, drafts, request }: AxisInput, context: VariantContext): AsyncResult<Timeline[]> {
  const candidates = (request.music ?? []).filter(fits(base));
  const used: MusicChoice[] = [base.music];
  const out: Timeline[] = [];
  for (const draft of drafts) {
    const choice = candidates.find((candidate) => !used.some((taken) => isDeepStrictEqual(taken, candidate)));
    if (!choice) break;
    used.push(choice);
    const varied = await withMusic(draft, choice, {
      ...(context.music?.trackBeats ? { trackBeats: context.music.trackBeats } : {}),
      templates: context.templates,
      ids: context.ids,
      ...(context.config ? { config: context.config } : {}),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    if (!varied.ok) return varied;
    out.push(varied.value.timeline);
  }
  return ok(out);
}

export const musicAxis: VariantAxis = { id: 'music', vary };
