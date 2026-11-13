// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The `timeline` tool module: full metadata, and each tool run against a real bus with source 'agent'. */
import { toolModuleProblems, toolSummary } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { agentWorld } from './fixtures/agent';

describe('timeline tools', () => {
  it('declare full metadata', () => {
    const { tools } = agentWorld();
    expect(toolModuleProblems(tools)).toEqual([]);
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'timeline.cast',
      'timeline.assemble',
      'timeline.get',
      'timeline.findAlternates',
      'timeline.swapClip',
      'timeline.trimClip',
      'timeline.moveClip',
      'timeline.editText',
      'timeline.moveText',
      'timeline.lockClip',
      'timeline.applyCast',
      'timeline.setClipFit',
      'timeline.resyncBeats',
      'timeline.trimToDuration',
      'timeline.setReframe',
      'timeline.splitClip',
      'timeline.deleteClip',
      'timeline.insertClip',
      'timeline.duplicateClip',
      'timeline.setSpeed',
      'timeline.setTransition',
      'timeline.removeTransition',
      'timeline.setGrade',
      'timeline.addMarker',
      'timeline.slipClip',
      'timeline.transcript',
      'timeline.removeWords',
      'timeline.replaceCaptions',
      'timeline.adjustClips',
      'timeline.copyClipSettings',
      'timeline.addNarration',
      'timeline.makeSize',
      'timeline.freezeFrame',
      'timeline.setHoldDuration',
      'timeline.setCover',
      'timeline.setVisualLayout',
      'timeline.exportInterchange',
      'timeline.gaps',
      'timeline.fillGap',
      'timeline.dropSlot',
      'timeline.markForFilming',
      'timeline.planCleanup',
      'timeline.applyCleanup',
      'timeline.planEnergyCurve',
      'timeline.applyEnergyCurve',
      'timeline.makeVariants',
      'timeline.setStyle',
      'timeline.applyStyleToMany',
    ]);
    for (const tool of tools.tools) expect(toolSummary(tool).length).toBeLessThanOrEqual(120);
  });

  // Review H3: an export waits for the person at the default autonomy and needs MCP's export level, like
  // render.export; the agent's policy and the MCP gateway both read `checkpoint`.
  it('mark the pro export as a checkpoint, and nothing that edits the timeline', () => {
    const { tools } = agentWorld();
    const checkpoints = tools.tools.filter((tool) => tool.checkpoint === true).map((tool) => tool.name);
    expect(checkpoints).toEqual(['timeline.exportInterchange']);
  });

  // Review M7: stock.search and stock.import aren't on the agent loop, so the gap list doesn't tell the model to
  // propose stock. (fillGap may still place a stock clip the person imported: that one is in the library.)
  it('list gaps without telling the model to propose a stock fix', () => {
    const { tools } = agentWorld();
    const gaps = tools.tools.find((tool) => tool.name === 'timeline.gaps');
    expect(gaps?.description).toMatch(/Propose a fix/);
    expect(`${gaps?.summary ?? ''} ${gaps?.description ?? ''}`).not.toMatch(/stock/i);
  });

  it('casts without writing, with the full result as an artifact', async () => {
    const { call, template, projectId, store, artifacts } = agentWorld();
    const cast = await call('timeline.cast', { projectId, template: { id: template.id }, variants: 2 });
    if (!cast.ok) throw new Error(cast.error.code);
    const variants = cast.value.variants as { slots: unknown[] }[];
    expect(variants).toHaveLength(2);
    expect(variants[0]!.slots).toHaveLength(4);
    expect(artifacts.size).toBe(1);
    expect(store.docs.size).toBe(0);
  });

  it('assembles every variant in one step, then reads, edits and finds alternates', async () => {
    const { call, template, projectId, store, bus } = agentWorld();
    const assembled = await call('timeline.assemble', { projectId, template: { id: template.id }, variants: 3 });
    if (!assembled.ok) throw new Error(assembled.error.code);
    const timelineIds = assembled.value.timelineIds as string[];
    expect(timelineIds).toHaveLength(3);
    expect(store.docs.size).toBe(3);
    const read = await call('timeline.get', { timelineId: timelineIds[0] });
    if (!read.ok) throw new Error(read.error.code);
    const clips = read.value.clips as { clipId: string; slotId: string; start: number }[];
    expect(clips.map((clip) => clip.start)).toEqual(template.slots.map((slot) => slot.start.value));
    const locked = await call('timeline.lockClip', { projectId, timelineId: timelineIds[0], clipId: clips[0]!.clipId, locked: true });
    expect(locked.ok && locked.value.revision).toBe(2);
    const trim = await call('timeline.trimClip', {
      projectId,
      timelineId: timelineIds[0],
      clip: clips[0]!.clipId,
      edge: 'end',
      by: { value: 3, rate: { num: 30, den: 1 } },
    });
    expect(!trim.ok && trim.error.code).toBe('timeline.clip_locked');
    const found = await call('timeline.findAlternates', { timelineId: timelineIds[0], slotId: clips[1]!.slotId, limit: 2 });
    expect(found.ok && (found.value.candidates as unknown[]).length).toBe(2);
    // One undo takes back all three variants.
    await bus.undo(projectId, { source: 'ui', actor: 'user' });
    await bus.undo(projectId, { source: 'ui', actor: 'user' });
    expect(store.docs.size).toBe(0);
  });

  it("gives every assembled cut the reel's own music when the template keeps its reel with sound (REF1)", async () => {
    for (const keptAudio of [true, false]) {
      const { call, template, projectId, store } = agentWorld(undefined, keptAudio);
      const assembled = await call('timeline.assemble', { projectId, template: { id: template.id }, variants: 2 });
      if (!assembled.ok) throw new Error(assembled.error.code);
      const music = [...store.docs.values()].map((doc) => (doc as { music: unknown }).music);
      expect(music).toEqual(
        Array(2).fill(keptAudio ? { path: 'referenceAudio', templateId: template.id, gainDb: 0 } : { path: 'platformSound' }),
      );
    }
  });

  it("applies QA's command fixes as tools: trimToDuration shortens the video on a beat", async () => {
    const { call, template, projectId, store } = agentWorld();
    const assembled = await call('timeline.assemble', { projectId, template: { id: template.id } });
    if (!assembled.ok) throw new Error(assembled.error.code);
    const timelineId = (assembled.value.timelineIds as string[])[0]!;
    const before = store.docs.get(timelineId)!;
    const frames = (doc: typeof before) => {
      const video = doc.tracks[0];
      return video?.kind === 'video'
        ? video.items.reduce((sum, item) => (item.type === 'transition' ? sum : sum + item.duration.value), 0)
        : 0;
    };
    const maxSeconds = Math.floor(frames(before) / 30 / 2);
    const trimmed = await call('timeline.trimToDuration', { projectId, timelineId, maxSeconds });
    expect(trimmed.ok && trimmed.value.revision).toBe(2);
    expect(frames(store.docs.get(timelineId)!)).toBeLessThanOrEqual(maxSeconds * 30);
    const resynced = await call('timeline.resyncBeats', { projectId, timelineId });
    expect(resynced.ok).toBe(true);
  });

  it('passes the template lookup error through', async () => {
    const { call, projectId, profiles } = agentWorld();
    const missing = await call('timeline.cast', { projectId, template: { id: profiles[0]!.assetId } });
    expect(!missing.ok && missing.error.code).toBe('timeline.template_not_found');
  });

  it('avoids colliding with an existing timelineId and offsets Variant names on re-assembly', async () => {
    const { call, template, projectId, store } = agentWorld();
    const first = await call('timeline.assemble', { projectId, template: { id: template.id }, variants: 1 });
    if (!first.ok) throw new Error(first.error.code);
    const firstId = (first.value.timelineIds as string[])[0]!;
    const second = await call('timeline.assemble', {
      projectId,
      template: { id: template.id },
      variants: 2,
      timelineIds: [firstId],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const secondIds = second.value.timelineIds as string[];
    expect(secondIds).not.toContain(firstId);
    expect([...store.docs.values()].map((doc) => doc.name)).toEqual(['Variant 1', 'Variant 2', 'Variant 3']);
    expect([...store.docs.values()].map((doc) => doc.cast?.variantIndex)).toEqual([0, 1, 2]);
  });
});
