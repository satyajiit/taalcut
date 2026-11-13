// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK, the gaps' reader's extras in the agent process. What each shot carries (the template's text overlays on
 * it, and the designed graphics drawing them). For an open shot: the clips other shots have that casting scores well
 * here (a swap from another shot, with what that shot gets instead: the open shot's own clip, or its best unused
 * one) and other parts of used clips long enough for two moments. And the person's new clips: counted from the
 * library (added since the cast began, searchable once indexed) and cast into the gaps that asked for them with
 * casting's alternates, in one `timeline.applyCast` (one undo step, by the agent). All scored by the casting engine;
 * a port that fails offers nothing rather than failing the step.
 */
import {
  CommandBusToken,
  ok,
  RationalTime,
  type AsyncResult,
  type CastCandidate,
  type Container,
  type Template,
  type Timeline,
} from '@taalcut/core';
import type {
  BorrowShot,
  GapCarry,
  GapClips,
  GapOffers,
  GapShot,
  GapSlot,
  GapTimeline,
  ReuseShot,
} from '@taalcut/agent';
import { clipsAddedSince } from '@taalcut/library';
import { CASTING_CONFIG, fitConfidence, type CastingEngine } from '@taalcut/timeline';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { CastingEngineToken } from './agent-casting';

/** How many of casting's ranked clips an open shot looks through for clips other shots have. */
const LOOK = 12;
/** At most this many clips per offer (core's limit). */
const OFFERED = 3;
/** Room left between two moments of one clip, in seconds. */
const APART = 0.25;
const ORIGIN = { source: 'agent' as const, actor: 'agent:gaps' };

type Describe = (shotIds: readonly string[]) => ReadonlyMap<string, string>;
type Media = { readonly assetId: string; readonly shotId: string | null };

const keyOf = (media: Media) => media.shotId ?? `asset:${media.assetId}`;
const unit = (fit: number) => Math.min(1, Math.max(0, fit));
const clears = (fit: number) => fitConfidence(fit, CASTING_CONFIG) >= CASTING_CONFIG.confidence.rerankBelow;

/** FIX-ASK: what of the template's each slot carries: a text overlay on it, and a designed graphic drawing one. */
export function carriesOf(template: Template | undefined): (slotId: string) => GapCarry[] {
  const drawn = new Set<string>((template?.graphics?.uses ?? []).map((use) => use.overlayId));
  const bySlot = new Map<string, Set<GapCarry>>();
  for (const overlay of template?.text ?? []) {
    if (!overlay.slotId) continue;
    const carries = bySlot.get(overlay.slotId) ?? new Set<GapCarry>();
    carries.add('text');
    if (drawn.has(overlay.id)) carries.add('graphics');
    bySlot.set(overlay.slotId, carries);
  }
  return (slotId) => [...(bySlot.get(slotId) ?? [])];
}

/** V1's clips by id. */
function clipsById(timeline: Timeline) {
  const track = timeline.tracks.find((t) => t.kind === 'video' && t.id === 'V1') ?? timeline.tracks[0];
  const items = track?.kind === 'video' ? track.items : [];
  return new Map<string, ClipLike>(
    items.flatMap((item) => (item.type === 'clip' ? [[item.id as string, item] as const] : [])),
  );
}

/** Where another moment of a used clip can start, long enough for `need` and clear of the part in use, or null. */
export function secondMoment(clip: ClipLike, need: RationalTime): RationalTime | null {
  if (clip.media.kind !== 'video' || clip.speed !== null) return null;
  const { start, duration } = clip.media.available;
  const from = RationalTime.toSeconds(start);
  const to = from + RationalTime.toSeconds(duration);
  const usedFrom = RationalTime.toSeconds(clip.sourceStart);
  const usedTo = usedFrom + RationalTime.toSeconds(clip.duration);
  const length = RationalTime.toSeconds(need);
  if (usedFrom - from >= length + APART) return start;
  if (to - usedTo >= length + APART) return RationalTime.fromSeconds(usedTo + APART, start.rate);
  return null;
}

interface ClipLike {
  readonly media:
    | {
        readonly kind: 'video';
        readonly available: { readonly start: RationalTime; readonly duration: RationalTime };
      }
    | { readonly kind: 'image' | 'audio' };
  readonly sourceStart: RationalTime;
  readonly duration: RationalTime;
  readonly speed: unknown;
}

interface OfferContext {
  readonly engine: CastingEngine;
  readonly template: Template;
  readonly timeline: Timeline;
  readonly gaps: GapTimeline;
  readonly describe: Describe;
  readonly signal: AbortSignal | undefined;
}

function neighbours(gaps: GapTimeline, slot: GapSlot) {
  const live = gaps.slots.filter((s) => s.state !== 'dropped').sort((a, b) => a.number - b.number);
  const at = live.findIndex((s) => s.gapId === slot.gapId);
  return { previous: live[at - 1]?.current ?? null, next: live[at + 1]?.current ?? null };
}

async function ranked(ctx: OfferContext, slot: GapSlot, used: readonly string[], limit: number) {
  if (!slot.slotId) return [];
  const found = await ctx.engine.alternates(
    {
      template: ctx.template,
      slotId: slot.slotId as never,
      ...neighbours(ctx.gaps, slot),
      used,
      exclude: [],
      limit,
      canvas: { width: ctx.timeline.canvas.width, height: ctx.timeline.canvas.height },
    },
    ctx.signal,
  );
  return found.ok ? found.value : [];
}

/** How well the clip a shot has fits it, as casting stored it. */
const fitThere = (timeline: Timeline, slot: GapSlot) =>
  unit(timeline.cast?.slots.find((s) => s.slotId === slot.slotId)?.pick?.parts.intent ?? 0);

/**
 * What the giving shot gets instead: the open shot's own clip when casting ranks it there (a straight trade), else
 * the giving shot's best clip no shot uses. Null: it would be left with nothing, so no borrow.
 */
async function insteadFor(ctx: OfferContext, giver: GapSlot, open: GapSlot, used: ReadonlySet<string>) {
  const own = open.current ? keyOf(open.current) : undefined;
  const others = [...used].filter((key) => key !== own);
  const options = await ranked(ctx, giver, others, LOOK);
  const trade = own ? options.find((c) => keyOf(c) === own) : undefined;
  const pick = trade ?? options.find((c) => !used.has(keyOf(c)));
  return pick ? { assetId: pick.assetId, shotId: pick.shotId, fit: unit(pick.parts.intent) } : null;
}

/** An open shot's offers: clips other shots have that fit here, and other parts of used clips. */
async function offersFor(ctx: OfferContext, slot: GapSlot): Promise<GapOffers> {
  const owners = new Map<string, GapSlot>();
  for (const s of ctx.gaps.slots) if (s.current && s.state !== 'dropped') owners.set(keyOf(s.current), s);
  const used = new Set(owners.keys());
  const clips = clipsById(ctx.timeline);
  const borrow: BorrowShot[] = [];
  const reuse: ReuseShot[] = [];
  const pending: { candidate: CastCandidate; owner: GapSlot }[] = [];
  for (const candidate of await ranked(ctx, slot, [], LOOK)) {
    const owner = owners.get(keyOf(candidate));
    if (!owner || owner.gapId === slot.gapId) continue;
    const clip = clips.get(owner.gapId);
    const start = clip && reuse.length < OFFERED ? secondMoment(clip, slot.duration) : null;
    const fit = unit(candidate.parts.intent);
    const shot = { assetId: candidate.assetId, shotId: candidate.shotId, description: null, fit };
    if (start) reuse.push({ ...shot, usedIn: owner.number, sourceStart: start });
    const givable = (owner.state === 'picked' || owner.state === 'weak') && owner.note !== 'userPick';
    if (givable && pending.length < OFFERED) pending.push({ candidate, owner });
  }
  for (const { candidate, owner } of pending) {
    const instead = await insteadFor(ctx, owner, slot, used);
    if (!instead) continue;
    const fit = unit(candidate.parts.intent);
    borrow.push({
      assetId: candidate.assetId,
      shotId: candidate.shotId,
      description: null,
      fit,
      better: clears(fit),
      from: {
        gapId: owner.gapId,
        slotId: owner.slotId,
        number: owner.number,
        fit: fitThere(ctx.timeline, owner),
      },
      instead: { ...instead, description: null },
    });
  }
  return described(ctx.describe, { borrow, reuse });
}

/** The offers with what the library says each clip shows. */
function described(describe: Describe, offers: GapOffers): GapOffers {
  const shots = [...offers.borrow.flatMap((b) => [b, b.instead]), ...offers.reuse];
  const words = describe([...new Set(shots.flatMap((s) => (s.shotId ? [s.shotId] : [])))]);
  const say = <T extends GapShot>(shot: T): T => ({
    ...shot,
    description: shot.shotId ? (words.get(shot.shotId) ?? null) : null,
  });
  return {
    borrow: offers.borrow.map((b) => ({ ...say(b), instead: say(b.instead) })),
    reuse: offers.reuse.map(say),
  };
}

/** The gaps' timeline with each open shot's offers, when the engine is here; as it was otherwise. */
export async function withOffers(
  container: Container,
  read: { readonly timeline: Timeline; readonly template: Template | undefined; readonly gaps: GapTimeline },
  describe: Describe,
  signal?: AbortSignal,
): Promise<GapTimeline> {
  if (!read.template || !container.has(CastingEngineToken)) return read.gaps;
  const ctx: OfferContext = {
    engine: container.resolve(CastingEngineToken),
    template: read.template,
    timeline: read.timeline,
    gaps: read.gaps,
    describe,
    signal,
  };
  const slots: GapSlot[] = [];
  for (const slot of read.gaps.slots) {
    const open = slot.state === 'empty' || slot.state === 'weak';
    slots.push(open ? { ...slot, offers: await offersFor(ctx, slot) } : slot);
  }
  return { ...read.gaps, slots };
}

/**
 * The person's new clips: how many came in since a time and are ready, and the gaps cast again with them. An empty
 * shot takes casting's best unused clip that isn't a poor fit; an unsure one only a clip that clears casting's line
 * and fits better. Absent when the library, the engine or the bus isn't in this process.
 */
export function gapClips(
  container: Container,
  readAll: (
    timelineId: string,
  ) => AsyncResult<{
    readonly timeline: Timeline;
    readonly template: Template | undefined;
    readonly gaps: GapTimeline;
  }>,
): GapClips | undefined {
  if (![LibraryDatabaseToken, CastingEngineToken, CommandBusToken].every((token) => container.has(token)))
    return undefined;
  const db = container.resolve(LibraryDatabaseToken);
  return {
    async added(since) {
      try {
        return ok(clipsAddedSince(db, since));
      } catch {
        return ok({ added: 0, ready: 0 });
      }
    },
    async recast(timelineId, gapIds, signal) {
      const read = await readAll(timelineId);
      if (!read.ok) return read;
      const { timeline, template, gaps } = read.value;
      if (!template) return ok({ changed: 0 });
      const ctx: OfferContext = {
        engine: container.resolve(CastingEngineToken),
        template,
        timeline,
        gaps,
        describe: () => new Map(),
        signal,
      };
      const used = new Set(
        gaps.slots.flatMap((s) => (s.current && s.state !== 'dropped' ? [keyOf(s.current)] : [])),
      );
      const picks: { slotId: string; pick: CastCandidate }[] = [];
      for (const slot of gaps.slots) {
        if (!gapIds.includes(slot.gapId) || !slot.slotId) continue;
        const now = slot.state === 'weak' ? (slot.weak?.pick.fit ?? 0) : null;
        const best = (await ranked(ctx, slot, [...used], OFFERED)).find((c) => {
          const fit = unit(c.parts.intent);
          return now === null ? fitConfidence(fit, CASTING_CONFIG) > 0 : clears(fit) && fit > now;
        });
        if (!best) continue;
        used.add(keyOf(best));
        picks.push({ slotId: slot.slotId, pick: best });
      }
      if (picks.length === 0) return ok({ changed: 0 });
      const bus = container.resolve(CommandBusToken);
      const payload = { projectId: timeline.projectId, timelineId: timeline.id, picks };
      const applied = await bus.dispatch('timeline.applyCast', payload, ORIGIN);
      return applied.ok ? ok({ changed: picks.length }) : applied;
    },
  };
}
