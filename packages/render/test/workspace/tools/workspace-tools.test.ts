// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace tools (HFW1 dsn): registry-clean with their metadata; a blank scaffold that passes the real gate;
 * writes and patches through `workspace.writeFiles`, never into `_taalcut/`; the brief; a composition linted with
 * fix hints, rendered as images, placed as a proposal with its card, and replaced as the next version.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  motionGraphicCardSchema,
  ok,
  toolModuleProblems,
  toolNeedsApproval,
  type GraphicItem,
  type Timeline,
  type WorkspaceFramesInput,
} from '@taalcut/core';
import { rate, spokenTimeline } from '../../compositions/support';
import { workspaceWorld } from './support';

const fixture = (name: string) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

/** Stills that answer at once, one per second asked, with where the content sits and a passing frame check. */
const drawn: WorkspaceFramesInput[] = [];
const frames = async (input: WorkspaceFramesInput) => {
  drawn.push(input);
  return ok({
    frames: input.seconds.map((seconds) => ({
      seconds,
      mimeType: 'image/jpeg' as const,
      dataBase64: JPEG,
      width: 432,
      height: 768,
      box: seconds < 0.2 ? null : { x: 0.1, y: 0.62, width: 0.8, height: 0.1234567 },
    })),
    checks: [{ id: 'bounds', status: 'pass' as const }],
    ms: 5,
  });
};

const value = <T>(result: { ok: boolean; value?: unknown; error?: unknown }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value as T;
};

const graphicsOf = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item) => item.type === 'graphic') : [],
  ) as GraphicItem[];

describe('the workspace tools', () => {
  it('pass the registry’s checks and convert to JSON Schema, writes keyed and on their command', () => {
    const { module } = workspaceWorld(spokenTimeline([[10, 60, 'see you at the lake']]));
    expect(module.id).toBe('workspace');
    expect(toolModuleProblems(module)).toEqual([]);
    expect(module.tools.map((tool) => tool.name)).not.toContain('workspace.import');
    for (const tool of module.tools) {
      z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'throw' });
      z.toJSONSchema(tool.output, { io: 'output', unrepresentable: 'throw' });
      expect(tool.costClass).toBe('local');
      if (tool.sideEffect === 'write') expect(tool.idempotencyKey).toBeTypeOf('function');
      expect(tool.describeCall).toBeTypeOf('function');
    }
    const named = (name: string) => module.tools.find((tool) => tool.name === name)!;
    expect(named('workspace.write').command).toBe('workspace.writeFiles');
    expect(named('workspace.place').command).toBe('graphics.placeComposition');
    expect(named('workspace.replace').command).toBe('graphics.setComposition');
    expect(named('workspace.promote')).toMatchObject({ command: 'template.setGraphics', alwaysAsk: true });
    expect(toolNeedsApproval(named('workspace.promote'))).toBe(true);
    expect(named('workspace.render').images).toBeTypeOf('function');
    // Over the footage or a picture, the stills show the person's video: an upload, asked once in a run.
    expect(named('workspace.renderOver')).toMatchObject({
      sideEffect: 'external',
      permission: { network: 'internet', cloudModules: ['agent'], uploads: { what: 'user-media', consent: 'first-use' } },
    });
    expect(named('workspace.render')).toMatchObject({ sideEffect: 'read', permission: { network: 'none' } });
  });

  it('starts a blank scaffold that passes the gate, and holds no design', async () => {
    const world = workspaceWorld(spokenTimeline([[10, 60, 'see you at the lake']]));
    const made = value<{ path: string; revision: number }>(
      await world.call('workspace.new', { projectId: world.projectId, name: 'headline', seconds: 3 }),
    );
    expect(made).toMatchObject({ path: 'headline/index.html', revision: 1 });
    const lint = value<{ passed: boolean; findings: unknown[]; variables: unknown[]; durationSeconds: number }>(
      await world.call('workspace.lint', { projectId: world.projectId, entry: 'headline/index.html' }),
    );
    expect(lint).toMatchObject({ passed: true, variables: [], durationSeconds: 3 });
    const read = value<{ text: string }>(
      await world.call('workspace.read', { projectId: world.projectId, path: 'headline/index.html' }),
    );
    // Structure only: the root, its size and length, one paused timeline registered once; no colour, word or tween.
    expect(read.text).toContain('data-composition-id="headline"');
    expect(read.text).toContain("window.__timelines['headline'] = tl");
    // The script's comments show the one shape a tween takes; outside them, no colour and no tween.
    const running = read.text.replace(/^\s*\/\/.*$/gm, '');
    expect(running).not.toMatch(/#[0-9a-f]{6}|tl\.(to|from|fromTo)\(/);
    expect(read.text).toContain("//   tl.from('<selector>', { <property>: <value>, duration: <seconds>, ease: '<ease>' }, 'enter');");
    const again = await world.call('workspace.new', { projectId: world.projectId, name: 'headline' });
    expect(again.ok).toBe(false);
  });

  it('writes and patches over the head, refuses _taalcut/, and pages a read', async () => {
    const world = workspaceWorld(spokenTimeline([[10, 60, 'see you at the lake']]));
    const projectId = world.projectId;
    const reserved = await world.call('workspace.write', { projectId, path: '_taalcut/brief.md', text: 'mine' });
    expect(reserved.ok).toBe(false);
    value(await world.call('workspace.write', { projectId, path: 'notes/a.txt', text: 'one two two' }));
    const twice = await world.call('workspace.patch', { projectId, path: 'notes/a.txt', edits: [{ find: 'two', replace: '2' }] });
    expect(twice.ok ? '' : twice.error.detail).toContain('2 times');
    const patched = value<{ revision: number }>(
      await world.call('workspace.patch', { projectId, path: 'notes/a.txt', edits: [{ find: 'two', replace: '2', all: true }] }),
    );
    expect(patched.revision).toBe(2);
    const read = value<{ text: string; pages: number }>(await world.call('workspace.read', { projectId, path: 'notes/a.txt' }));
    expect(read).toMatchObject({ text: 'one 2 2', pages: 1 });
    const listed = value<{ files: { path: string }[]; brief: string }>(await world.call('workspace.list', { projectId }));
    expect(listed.files.map((file) => file.path)).toEqual(['notes/a.txt']);
    expect(listed.brief).toBe('_taalcut/brief.md');
  });

  it('writes the brief from the timeline: canvas, safe rect, fonts, plugins, moments', async () => {
    const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
    const world = workspaceWorld(timeline);
    const brief = value<{ text: string; path: string }>(
      await world.call('workspace.read', { projectId: world.projectId, timelineId: timeline.id }),
    );
    expect(brief.path).toBe('_taalcut/brief.md');
    for (const part of ['1080 × 1920', 'Safe rect', 'Poppins', 'SplitText', 'assets/<sha256>', '"see you at the lake"'])
      expect(brief.text).toContain(part);
    expect(brief.text).toContain('None yet.');
  });

  it('lints a refused script with fix hints, and place refuses it', async () => {
    const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
    const world = workspaceWorld(timeline);
    const bad = (await fixture('bubble.html')).replace("tl.addLabel('enter', 0);", "tl.addLabel('enter', 0);\n        fetch('/x');");
    value(await world.call('workspace.write', { projectId: world.projectId, path: 'bubble/index.html', text: bad }));
    const lint = value<{ passed: boolean; findings: { code: string; fixHint: string }[] }>(
      await world.call('workspace.lint', { projectId: world.projectId, entry: 'bubble/index.html' }),
    );
    expect(lint.passed).toBe(false);
    expect(lint.findings[0]?.fixHint.length).toBeGreaterThan(0);
    const placed = await world.call('workspace.place', {
      projectId: world.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      entry: 'bubble/index.html',
      name: 'Chat bubble',
      request: 'a chat bubble asking about the lake',
      at: 0.5,
    });
    expect(placed.ok ? '' : placed.error.detail).toContain('did not pass the gate');
  });

  it('renders stills as images, places a proposal with its card, and replaces it as version 2', async () => {
    const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
    const world = workspaceWorld(timeline, { frames });
    const { projectId } = world;
    value(await world.call('workspace.write', { projectId, path: 'bubble/index.html', text: await fixture('bubble.html') }));
    const render = value<{ frames: { image: { id: string } }[]; checks: unknown[]; rendersLeft: number }>(
      await world.call('workspace.renderOver', {
        projectId,
        entry: 'bubble/index.html',
        seconds: [0.45, 1.5, 2.8],
        over: 'footage',
        timelineId: timeline.id,
        at: 0.5,
      }),
    );
    expect(render.frames).toHaveLength(3);
    expect(render.rendersLeft).toBe(24);
    expect((render.frames[0] as { box?: unknown }).box).toEqual({ x: 0.1, y: 0.62, width: 0.8, height: 0.123 });
    expect(drawn.at(-1)?.over).toMatchObject({ kind: 'footage', timelineId: timeline.id, start: 0.5 });
    // Over a picture: an image artifact (a reference frame) goes to the worker as its bytes.
    const reference = await world.artifacts.put({ mediaType: 'image/jpeg', data: Buffer.from(JPEG, 'base64'), summary: 'a frame' });
    if (!reference.ok) throw new Error('no artifact');
    const over = value<{ frames: { box?: unknown }[] }>(
      await world.call('workspace.renderOver', { projectId, entry: 'bubble/index.html', seconds: [0.1, 2.5], over: 'image', imageId: reference.value.id }),
    );
    expect(over.frames[0]?.box).toBeNull();
    expect(drawn.at(-1)?.over).toEqual({ kind: 'image', mimeType: 'image/jpeg', dataBase64: JPEG });
    const images = world.tool('workspace.renderOver').images!(render as never);
    expect(images.map((ref) => ref.mediaType)).toEqual(['image/jpeg', 'image/jpeg', 'image/jpeg']);
    const placed = value<{ itemIds: string[]; compositionId: string; posterArtifactId?: string; version: number }>(
      await world.call('workspace.place', {
        projectId,
        timelineId: timeline.id,
        revision: timeline.revision,
        entry: 'bubble/index.html',
        name: 'Chat bubble',
        request: 'a chat bubble asking about the lake',
        phrase: 'see you at the lake',
        params: { message: 'Still on for the lake?' },
      }),
    );
    expect(placed.version).toBe(1);
    // Placing the same unchanged composition entry at another moment reuses the same compositionId.
    const afterFirst = value<Timeline>(await world.store.get(timeline.id));
    const placedSecond = value<{ itemIds: string[]; compositionId: string; version: number }>(
      await world.call('workspace.place', {
        projectId,
        timelineId: timeline.id,
        revision: afterFirst.revision,
        entry: 'bubble/index.html',
        name: 'Chat bubble',
        request: 'a chat bubble asking about the lake',
        at: 1.5,
        params: { message: 'Second bubble' },
      }),
    );
    expect(placedSecond.compositionId).toBe(placed.compositionId);
    expect(placedSecond.version).toBe(1);
    value(await world.bus.undo(projectId, { source: 'ui', actor: 'user' }));
    // The poster is the newest render's still nearest the middle of its 3 s.
    expect(placed.posterArtifactId).toBeTypeOf('string');
    const after = value<Timeline>(await world.store.get(timeline.id));
    const [graphic] = graphicsOf(after);
    expect(graphic?.composition).toMatchObject({ id: placed.compositionId, params: { message: 'Still on for the lake?' } });
    expect(graphic?.proposal?.design).toBe('designed');
    expect(after.graphicCompositions?.[0]).toMatchObject({ name: 'Chat bubble', version: 1, durationSeconds: 3 });
    expect(after.graphicCompositions?.[0]?.gate.passed).toBe(true);
    const card = await world.tool('workspace.place').resultCard!(placed as never, {
      runId: world.runId,
      toolCallId: 'x' as never,
      projectId,
      signal: new AbortController().signal,
    });
    const parsed = motionGraphicCardSchema.parse(card.ok ? card.value : null);
    expect(parsed).toMatchObject({ composition: { name: 'Chat bubble' }, frameArtifactId: placed.posterArtifactId });
    // A redesign: the next version under the same id, each graphic keeping its words.
    const blue = (await fixture('bubble.html')).replace('border-radius: 44px', 'border-radius: 12px');
    value(await world.call('workspace.write', { projectId, path: 'bubble/index.html', text: blue }));
    // Placing the changed design is refused: a redesign is workspace.replace, and the refusal names its graphics.
    const second = await world.call('workspace.place', {
      projectId,
      timelineId: timeline.id,
      revision: after.revision,
      entry: 'bubble/index.html',
      name: 'Chat bubble',
      request: 'make it rounder',
      at: 2,
    });
    expect(second.ok ? '' : second.error.detail).toContain(`workspace.replace with itemIds [${graphic!.id}]`);
    const replaced = value<{ version: number; compositionId: string }>(
      await world.call('workspace.replace', {
        projectId,
        timelineId: timeline.id,
        revision: after.revision,
        entry: 'bubble/index.html',
        itemIds: [graphic!.id],
      }),
    );
    expect(replaced).toMatchObject({ version: 2, compositionId: placed.compositionId });
    const latest = value<Timeline>(await world.store.get(timeline.id));
    expect(graphicsOf(latest)[0]?.composition.params).toEqual({ message: 'Still on for the lake?' });
    expect(latest.graphicCompositions?.map((copy) => copy.version)).toEqual([1, 2]);
    // Editing a variable's default in data-composition-variables and calling workspace.replace without params updates the item's param.
    const editedDefault = blue.replace(
      '"default":"Are we still on for the lake?"',
      '"default":"OK"',
    );
    value(await world.call('workspace.write', { projectId, path: 'bubble/index.html', text: editedDefault }));
    value(
      await world.call('workspace.replace', {
        projectId,
        timelineId: timeline.id,
        revision: latest.revision,
        entry: 'bubble/index.html',
        itemIds: [graphic!.id],
      }),
    );
    const afterDefaultEdit = value<Timeline>(await world.store.get(timeline.id));
    expect(graphicsOf(afterDefaultEdit)[0]?.composition.params).toEqual({ message: 'OK' });
    expect(world.tool('workspace.write').describeCall?.({ projectId, path: 'vietnam-chat/index.html', text: '' }, { path: 'vietnam-chat/index.html', revision: 1, bytes: 0 })).toBe('Vietnam chat');
    expect(rate.num).toBe(30);
  });

  it('says it can’t render without stills, and stops a run at 25 renders', async () => {
    const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
    const none = workspaceWorld(timeline);
    value(await none.call('workspace.new', { projectId: none.projectId, name: 'card' }));
    const refused = await none.call('workspace.render', { projectId: none.projectId, entry: 'card/index.html', seconds: [1] });
    expect(refused.ok ? '' : refused.error.code).toBe('core.not_implemented');
    const world = workspaceWorld(timeline, { frames });
    value(await world.call('workspace.new', { projectId: world.projectId, name: 'card' }));
    const input = { projectId: world.projectId, entry: 'card/index.html', seconds: [1] };
    for (let index = 0; index < 25; index++) value(await world.call('workspace.render', input));
    const capped = await world.call('workspace.render', input);
    expect(capped.ok ? '' : capped.error.detail).toContain('25 renders');
  });
});
