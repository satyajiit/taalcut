// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK, the gaps' reader's extras in the agent process, over a stand-in casting engine and made-up clips: what
 * each slot carries; where a second moment of a used clip can start; a swap from another shot (what that shot gets
 * instead, never from the person's own pick); and the person's new clips cast into the gaps in one applyCast.
 */
import { describe, expect, it } from 'vitest';
import {
  CommandBusToken,
  createContainer,
  newId,
  ok,
  RationalTime,
  type CastCandidate,
  type CommandBus,
  type Template,
  type Timeline,
} from '@taalcut/core';
import type { GapSlot, GapTimeline } from '@taalcut/agent';
import { CASTING_CONFIG, type AlternatesRequest, type CastingEngine } from '@taalcut/timeline';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { CastingEngineToken } from '../src/utility/roots/agent-casting';
import { carriesOf, gapClips, secondMoment, withOffers } from '../src/utility/roots/agent-gap-offers';

const fps = { num: 30, den: 1 };
const sec = (s: number) => RationalTime.fromSeconds(s, fps);

function candidate(intent: number): CastCandidate {
  return {
    assetId: newId<'Asset'>(),
    shotId: newId<'Shot'>(),
    sourceStart: RationalTime.zero(fps),
    syncPoint: null,
    score: intent,
    parts: {
      intent,
      motion: 0.5,
      quality: 0.5,
      subject: 0.5,
      energy: 0.5,
      hook: null,
      rerank: null,
      penalty: 0,
    },
  } as CastCandidate;
}

const media = (c: CastCandidate) => ({ assetId: c.assetId as string, shotId: c.shotId as string | null });

function slot(
  number: number,
  state: GapSlot['state'],
  current: CastCandidate | null,
  extra: Partial<GapSlot> = {},
) {
  return {
    gapId: newId<'TimelineItem'>(),
    slotId: newId<'TemplateSlot'>(),
    number,
    start: sec((number - 1) * 2),
    duration: sec(2),
    intent: null,
    note: null,
    state,
    ...(current ? { current: media(current) } : {}),
    ...extra,
  } as GapSlot;
}

function engineOf(alternates: (request: AlternatesRequest) => CastCandidate[]): CastingEngine {
  return {
    config: CASTING_CONFIG,
    cast: async () => ok(undefined as never),
    hookVariants: async () => ok([]),
    alternates: async (request) => ok(alternates(request)),
  };
}

/** A timeline over the slots: V1 holds a 2 s clip per filled slot, each from a 10 s source at `usedFrom`. */
function timelineOf(slots: GapSlot[], picks: Map<string, CastCandidate>, usedFrom = 0): Timeline {
  const items = slots.flatMap((s) =>
    s.current
      ? [
          {
            type: 'clip',
            id: s.gapId,
            slotId: s.slotId,
            duration: sec(2),
            sourceStart: sec(usedFrom),
            speed: null,
            media: { kind: 'video', ...s.current, available: { start: sec(0), duration: sec(10) } },
          },
        ]
      : [{ type: 'gap', id: s.gapId, slotId: s.slotId, duration: sec(2) }],
  );
  return {
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    canvas: { width: 1080, height: 1920, rate: fps },
    tracks: [{ kind: 'video', id: 'V1', items }],
    cast: {
      slots: slots.map((s) => ({ slotId: s.slotId, pick: picks.get(s.gapId) ?? null })),
    },
  } as unknown as Timeline;
}

const gapsOf = (slots: GapSlot[]): GapTimeline => ({
  timelineId: newId<'Timeline'>(),
  projectId: newId<'Project'>(),
  revision: 2,
  duration: sec(slots.length * 2),
  minDuration: null,
  slots,
  slotCount: slots.length,
});

describe("the gaps' reader's extras (FIX-ASK)", () => {
  it('says which slots carry the template’s text, and which a designed graphic draws', () => {
    const [a, b, c] = [newId<'TemplateSlot'>(), newId<'TemplateSlot'>(), newId<'TemplateSlot'>()];
    const drawn = newId<'TextOverlay'>();
    const template = {
      text: [
        { id: newId<'TextOverlay'>(), slotId: a },
        { id: drawn, slotId: b },
        { id: newId<'TextOverlay'>(), slotId: null },
      ],
      graphics: { uses: [{ overlayId: drawn, compositionId: newId<'GraphicComposition'>() }] },
    } as unknown as Template;
    const carries = carriesOf(template);
    expect([carries(a), carries(b), carries(c)]).toEqual([['text'], ['text', 'graphics'], []]);
    expect(carriesOf(undefined)(a)).toEqual([]);
  });

  it('finds a second moment of a clip before or after the part in use, only when there is room', () => {
    const clip = (from: number, length: number) => ({
      media: { kind: 'video' as const, available: { start: sec(0), duration: sec(10) } },
      sourceStart: sec(from),
      duration: sec(length),
      speed: null,
    });
    expect(secondMoment(clip(4, 2), sec(2))).toEqual(sec(0));
    expect(RationalTime.toSeconds(secondMoment(clip(0, 4), sec(3))!)).toBeCloseTo(4.25, 1);
    expect(secondMoment(clip(1, 8), sec(2))).toBeNull();
    expect(secondMoment({ ...clip(0, 1), speed: { kind: 'ramp' } }, sec(2))).toBeNull();
  });

  it("offers an open shot another shot's clip, with what that shot gets instead, never the person's own pick", async () => {
    const neon = candidate(0.45);
    const phone = candidate(0.85);
    const mine = candidate(0.9);
    const opening = slot(1, 'weak', neon);
    const giver = slot(2, 'picked', phone);
    const own = slot(3, 'picked', mine, { note: 'userPick' });
    const slots = [opening, giver, own];
    const picks = new Map([
      [giver.gapId, { ...phone, parts: { ...phone.parts, intent: 0.3 } }],
      [own.gapId, mine],
    ]);
    const engine = engineOf((request) => {
      if (request.slotId === opening.slotId) return [mine, phone];
      // Shot 2 ranks the opening's neon sign, so the two trade.
      if (request.slotId === giver.slotId) return [{ ...neon, parts: { ...neon.parts, intent: 0.33 } }];
      return [];
    });
    const container = createContainer().value(CastingEngineToken, engine);
    const read = { timeline: timelineOf(slots, picks, 0), template: {} as Template, gaps: gapsOf(slots) };
    const offered = await withOffers(container, read, () => new Map([[phone.shotId as string, 'A phone']]));
    const offers = offered.slots[0]?.offers;
    expect(offers?.borrow).toEqual([
      expect.objectContaining({
        assetId: phone.assetId,
        description: 'A phone',
        fit: 0.85,
        better: true,
        from: { gapId: giver.gapId, slotId: giver.slotId, number: 2, fit: 0.3 },
        instead: expect.objectContaining({ assetId: neon.assetId, fit: 0.33 }),
      }),
    ]);
    // Both used clips run 2 s of 10: another part of each can fill the opening too.
    expect(offers?.reuse.map((r) => [r.assetId, r.usedIn])).toEqual([
      [mine.assetId, 3],
      [phone.assetId, 2],
    ]);
    expect(offered.slots[1]?.offers).toBeUndefined();
  });

  it("casts the person's new clips into the gaps that asked, in one applyCast by the agent", async () => {
    const empty = slot(1, 'empty', null);
    const unsure = slot(2, 'weak', candidate(0.4), {
      weak: {
        pick: { ...media(candidate(0.4)), description: null, fit: 0.4 },
        confidence: 0.1,
        candidates: [],
        better: null,
      },
    });
    const slots = [empty, unsure, slot(3, 'picked', candidate(0.8))];
    const fresh = candidate(0.62);
    const poor = candidate(0.41);
    const engine = engineOf((request) => (request.slotId === empty.slotId ? [fresh] : [poor]));
    const dispatched: { name: string; payload: unknown; origin: unknown }[] = [];
    const bus = {
      dispatch: async (name: string, payload: unknown, origin: unknown) => {
        dispatched.push({ name, payload, origin });
        return ok({});
      },
    } as unknown as CommandBus;
    const counts = { prepare: () => ({ get: () => ({ added: 2, ready: 1 }) }) };
    const container = createContainer()
      .value(CastingEngineToken, engine)
      .value(CommandBusToken, bus)
      .value(LibraryDatabaseToken, { driver: counts } as never);
    const timeline = timelineOf(slots, new Map());
    const clips = gapClips(container, async () =>
      ok({ timeline, template: {} as Template, gaps: gapsOf(slots) }),
    );
    expect(await clips!.added(0, new AbortController().signal)).toEqual(ok({ added: 2, ready: 1 }));
    const recast = await clips!.recast(
      timeline.id,
      [empty.gapId, unsure.gapId],
      new AbortController().signal,
    );
    // The empty shot takes the new clip; the unsure one keeps its clip, since nothing clears casting's line.
    expect(recast).toEqual(ok({ changed: 1 }));
    expect(dispatched).toEqual([
      {
        name: 'timeline.applyCast',
        payload: {
          projectId: timeline.projectId,
          timelineId: timeline.id,
          picks: [{ slotId: empty.slotId, pick: fresh }],
        },
        origin: { source: 'agent', actor: 'agent:gaps' },
      },
    ]);
    expect(
      gapClips(createContainer(), async () => ok({ timeline, template: undefined, gaps: gapsOf(slots) })),
    ).toBeUndefined();
  });
});
