// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  agentTurnGroup,
  CancelledError,
  CommandBusToken,
  err,
  FrameRate,
  newId,
  NotFoundError,
  ok,
  parseId,
  RationalTime,
  ValidationError,
  type CommandToolContext,
  type Container,
} from '@taalcut/core';
import type { ShortsDependencies } from '@taalcut/shorts';
import { assembleShort } from '@taalcut/timeline';
import { renderTimelines } from '../../shared/render-ports';
import { resolveShortBrand } from './shorts-brand';
import { finishShortGraphics } from './shorts-design';
import { exportShort } from './shorts-export';
import { shortLayouts } from './shorts-framing';
import { shortsSourceRanges } from './shorts-source';
import { shortSourceSignature } from './shorts-integrity';

/** Every edit remains a normal editor command, outside a command handler's project lock. */
export function shortComposer(container: Container, ctx: CommandToolContext): ShortsDependencies['compose'] {
  return async (runId, request, plan, signal) => {
    if (signal?.aborted) return err(CancelledError());
    // A run owns one timeline even if the process dies after creation but before the run row is saved.
    const timelineId = parseId<'Timeline'>(runId);
    if (!timelineId.ok) return timelineId;
    const access = renderTimelines(container);
    let current = await access.get(timelineId.value);
    if (!current.ok && !NotFoundError.is(current.error)) return current;
    const assets = shortsSourceRanges(
      container,
      [...plan.speech, ...plan.visuals].map((span) => span.source.assetId),
    );
    if (!assets.ok) return assets;
    const expected = assembleShort(
      {
        projectId: request.projectId,
        timelineId: timelineId.value,
        name: plan.title,
        rate: FrameRate.of(30),
        plan,
        assets: assets.value,
        styleId: null,
        now: Date.now(),
      },
      { item: () => newId<'TimelineItem'>() },
    );
    if (!expected.ok) return expected;
    const unchanged = () =>
      current.ok && shortSourceSignature(current.value) === shortSourceSignature(expected.value);
    const changed = () =>
      ok({
        timelineId: timelineId.value,
        revision: current.ok ? current.value.revision : 1,
        renderIds: [],
        issues: [
          'Source edits changed after verification. Review this draft or generate a new short before exporting.',
        ],
      });
    if (current.ok && !unchanged()) return changed();
    const brand = await resolveShortBrand(container, request, plan, ctx);
    if (!brand.ok) return brand;
    if (!current.ok) {
      const layouts = await shortLayouts(container, plan, signal);
      if (!layouts.ok) return layouts;
      const assembled = assembleShort(
        {
          projectId: request.projectId,
          timelineId: timelineId.value,
          name: plan.title,
          rate: FrameRate.of(30),
          plan,
          assets: assets.value,
          styleId: brand.value?.id ?? null,
          layouts: layouts.value,
          now: Date.now(),
        },
        { item: () => newId<'TimelineItem'>() },
      );
      if (!assembled.ok) return assembled;
      const created = await ctx.dispatch({ projectId: request.projectId, timelines: [assembled.value] });
      if (!created.ok) return created;
      current = await access.get(timelineId.value);
    }
    if (!current.ok) return current;
    if (current.value.projectId !== request.projectId)
      return err(ValidationError({ field: 'shorts.timelineProject' }));
    const bus = container.resolve(CommandBusToken);
    const origin = { source: 'agent' as const, actor: `agent:${ctx.runId ?? ctx.callId}` };
    const group = ctx.runId ? { group: agentTurnGroup(ctx.runId) } : {};
    if (!current.value.captions && plan.speech.some((span) => span.source.wordStart !== undefined)) {
      const captions = await bus.dispatch(
        'captions.rebuild',
        {
          projectId: request.projectId,
          timelineId: current.value.id,
          revision: current.value.revision,
        },
        origin,
        { ...group, idempotencyKey: `shorts.captions:${runId}` },
      );
      if (!captions.ok) return captions;
    }
    current = await access.get(timelineId.value);
    if (!current.ok) return current;
    const designed = await finishShortGraphics(container, request, plan, current.value, brand.value, ctx);
    if (!designed.ok) {
      if (ValidationError.is(designed.error) && designed.error.params?.field === 'shorts.graphics') {
        const draft = await access.get(timelineId.value);
        if (!draft.ok) return draft;
        return ok({
          timelineId: draft.value.id,
          revision: draft.value.revision,
          renderIds: [],
          issues: ['The title or ending graphic needs review before this short can be exported.'],
        });
      }
      return designed;
    }
    current = await access.get(timelineId.value);
    if (!current.ok) return current;
    // A frame from the finished timeline is the cover. No generated scene is substituted for source footage.
    if (!current.value.covers?.some((cover) => cover.aspect === '9:16')) {
      const cover = await bus.dispatch(
        'timeline.setCover',
        {
          projectId: request.projectId,
          timelineId: current.value.id,
          revision: current.value.revision,
          cover: {
            aspect: '9:16',
            source: {
              kind: 'frame',
              frame: Math.min(30, RationalTime.toFrames(plan.duration, current.value.canvas.rate) - 1),
            },
            archetype: 'minimal-frame',
            theme: 'golden-hour',
            textAlign: 'bottom-left',
            hookText: '',
            kickerText: '',
            statBadge: '',
          },
        },
        origin,
        { ...group, idempotencyKey: `shorts.coverChoice:${runId}` },
      );
      if (!cover.ok) return cover;
    }
    current = await access.get(timelineId.value);
    if (!current.ok) return current;
    if (!unchanged()) return changed();
    const exported = await exportShort(container, runId, request, current.value, ctx);
    return exported.ok
      ? ok({ timelineId: current.value.id, revision: current.value.revision, ...exported.value })
      : exported;
  };
}
