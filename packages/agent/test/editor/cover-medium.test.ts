// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: the handoff holds a cover to what it is made of, from facts the run has: the tool that saved it, the
 * medium the model stated on the save, the pictures it named, and what image tools returned in this run. The
 * person's words are never read: a request from the cover panel without a note named no medium, and that is data.
 */
import { newId, type CoverRequest, type ThumbnailAspect } from '@taalcut/core';
import { editorBrief } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { coverHandoffProblem } from '../../src/editor/cover-completion';
import { initialState, type StepState, type ToolCallState } from '../../src/run-state';
import { contextOf, editorWorld } from './editor-support';

function scenario(cover: CoverRequest | undefined, message = 'Generate a 9:16 cover for this video.') {
  const world = editorWorld();
  const timeline = world.v.timeline;
  const state = initialState(newId<'AgentRun'>());
  state.started = {
    conversationId: 'c',
    message,
    autonomy: 'autopilot',
    budget: state.budget,
    localOnly: false,
    soulVersion: 'test',
    catalogueHash: 'test',
    editor: editorBrief(message, contextOf(world), timeline, cover),
  };
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  const step: StepState = {
    id: 'cover',
    text: 'Cover',
    skill: 'timeline.editor',
    status: 'doing',
    turns: 1,
    verifyRetries: 0,
    ended: false,
    summary: '',
    input: { ...target, request: message },
  };
  const record = (tool: string, input: Record<string, unknown>, value: unknown) => {
    const id = newId<'ToolRun'>();
    const requested: ToolCallState['requested'] = {
      toolCallId: id,
      modelCallId: 'm1',
      modelToolCallId: `call-${state.toolCallOrder.length}`,
      tool,
      callName: tool.replace('.', '_'),
      meta: false,
      sideEffect: 'write',
      input,
    };
    const payload = {
      toolCallId: id,
      output: { kind: 'inline' as const, value },
      cached: false,
      deduplicated: false,
      attempts: 1,
      durationMs: 1,
      usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
    };
    state.toolCallOrder.push(id);
    state.toolCalls[id] = { requestedAt: 0, requested, outcome: { kind: 'completed', at: 1, payload } };
  };
  const receipt = { timelineId: timeline.id, revision: 43 };
  return {
    /** workspace.placeCover: a designed composition, with its medium and pictures. */
    place: (medium: string | undefined, pictures: unknown[], aspect: ThumbnailAspect = '9:16') =>
      record(
        'workspace.placeCover',
        {
          ...target,
          revision: 42,
          entry: 'cover/index.html',
          aspect,
          pictures,
          ...(medium ? { medium } : {}),
        },
        receipt,
      ),
    /** timeline.setCover: a frame or an image as it is. */
    set: (source: unknown, medium = 'footage') =>
      record(
        'timeline.setCover',
        { ...target, revision: 42, cover: { aspect: '9:16', source, medium } },
        receipt,
      ),
    generated: (assetId: string) =>
      record('images.generateThumbnail', { projectId: target.projectId }, { thumbnails: [{ assetId }] }),
    exported: (width = 1080, height = 1920) =>
      record(
        'render.exportCover',
        { ...target, revision: 43 },
        { fileName: 'cover.jpg', width, height, revision: 43 },
      ),
    problem: () => coverHandoffProblem(state, step, receipt),
  };
}

const HERO = [{ name: 'hero', frame: 12 }];

describe('a cover asked for in the cover panel with no note (CVR2)', () => {
  it('passes as a designed composition over a frame of the video, stated as footage', async () => {
    const s = scenario({ aspect: '9:16' });
    s.place('footage', HERO);
    s.exported();
    expect(await s.problem()).toBeUndefined();
  });

  it('says in words that there is no cover, and that a cover at another aspect is not it', async () => {
    const none = scenario({ aspect: '9:16' });
    expect(await none.problem()).toBe(
      "The user asked for this cover at 9:16 in the editor's cover panel, so the step owes a cover at 9:16. " +
        'No cover was saved at 9:16 in this run; exporting an earlier cover is not it. ' +
        'No JPEG at 9:16 for this timeline and revision is recorded. ' +
        'Save the cover with workspace.placeCover and aspect "9:16", then call render.exportCover with aspect ' +
        '"9:16" and the revision it returned, and inspect the saved image before reporting completion. If a ' +
        'cover at 9:16 cannot be made, explain that visibly and repeat the explanation verbatim in ' +
        'handOff.notSavedCoverReason.',
    );
    const wide = scenario({ aspect: '9:16' });
    wide.place('footage', HERO, '16:9');
    wide.exported(1920, 1080);
    const other = await wide.problem();
    expect(other).toContain('No cover was saved at 9:16 in this run');
    expect(other).toContain('The JPEG exported at this revision is 1920x1080, not 9:16.');
  });

  it('refuses a bare frame: a frame saved as it is, is not a designed cover', async () => {
    const s = scenario({ aspect: '9:16' });
    s.set({ kind: 'frame', frame: 12 });
    s.exported();
    expect(await s.problem()).toBe(
      'The cover saved is a frame as it is (timeline.setCover): a bare frame is not a designed cover. ' +
        'Choose frames with timeline.captureFrame, write a composition on the cover’s canvas (workspace.new ' +
        'with cover) that draws them with <img data-picture>, and save it with workspace.placeCover, medium ' +
        '"footage". Then export it again.',
    );
    // Designed after all, the same run passes.
    s.place('footage', HERO);
    expect(await s.problem()).toBeUndefined();
  });

  it('refuses drawn art and generated art that nobody asked for', async () => {
    const drawn = scenario({ aspect: '9:16' });
    drawn.place('drawn', []);
    drawn.exported();
    expect(await drawn.problem()).toBe(
      'The cover saved states medium "drawn", and the person asked for none: they pressed Generate with AI and ' +
        'left no note, so the cover’s picture is the video’s own footage, not drawn or generated art. Choose ' +
        'frames with timeline.captureFrame, write a composition on the cover’s canvas (workspace.new with ' +
        'cover) that draws them with <img data-picture>, and save it with workspace.placeCover, medium ' +
        '"footage". Then export it again.',
    );

    const art = newId<'Asset'>();
    const generated = scenario({ aspect: '9:16' });
    generated.generated(art);
    generated.place('generated', [{ name: 'art', assetId: art }]);
    generated.exported();
    expect(await generated.problem()).toContain('states medium "generated", and the person asked for none');

    // Calling it footage does not make it footage: the picture came from an image tool in this run.
    const passedOff = scenario({ aspect: '9:16' });
    passedOff.generated(art);
    passedOff.place('footage', [{ name: 'art', assetId: art }]);
    passedOff.exported();
    expect(await passedOff.problem()).toBe(
      `The cover states medium "footage" and its picture ${art} was made by an image tool in this run: that is ` +
        'generated art, which the person did not ask for. Use frames of the video (pictures: [{name, frame}]) ' +
        'or their own library shots, and place and export it again.',
    );

    // Nor is a footage cover one with no picture at all: what it shows is drawn.
    const empty = scenario({ aspect: '9:16' });
    empty.place('footage', []);
    empty.exported();
    expect(await empty.problem()).toContain('states medium "footage" and names no picture');

    // A library shot the person already had is their footage.
    const own = scenario({ aspect: '9:16' });
    own.place('footage', [{ name: 'hero', assetId: newId<'Asset'>(), seconds: 3 }]);
    own.exported();
    expect(await own.problem()).toBeUndefined();
  });

  it('wants the medium stated on the save', async () => {
    const s = scenario({ aspect: '9:16' });
    s.place(undefined, HERO);
    s.exported();
    expect(await s.problem()).toContain('saved without its medium');
  });
});

describe('a cover asked for with the person’s own note (CVR2)', () => {
  it('takes the medium the model understood from it, and holds the cover to that medium', async () => {
    const note = { aspect: '9:16', note: 'An illustrated night market, no photo' } as const;
    const art = newId<'Asset'>();
    const generated = scenario(note);
    generated.generated(art);
    generated.place('generated', [{ name: 'art', assetId: art }]);
    generated.exported();
    expect(await generated.problem()).toBeUndefined();

    const drawn = scenario(note);
    drawn.place('drawn', []);
    drawn.exported();
    expect(await drawn.problem()).toBeUndefined();

    // Generated art that is only frames is not generated art.
    const frames = scenario(note);
    frames.place('generated', HERO);
    frames.exported();
    expect(await frames.problem()).toContain(
      'states medium "generated" and none of its pictures is an image',
    );

    // The panel's cover is designed whatever the note says.
    const bare = scenario(note);
    bare.set({ kind: 'frame', frame: 12 });
    bare.exported();
    expect(await bare.problem()).toContain('a bare frame is not a designed cover');
  });
});

describe('a cover asked for in the chat, with no panel request (CVR2)', () => {
  it('still refuses generated art saved as footage, and lets a frame as it is through', async () => {
    const art = newId<'Asset'>();
    const s = scenario(undefined, 'make a thumbnail');
    s.generated(art);
    s.place('footage', [{ name: 'art', assetId: art }]);
    s.exported();
    expect(await s.problem()).toContain('was made by an image tool in this run');

    const frame = scenario(undefined, 'make a thumbnail');
    frame.set({ kind: 'frame', frame: 12 });
    frame.exported();
    expect(await frame.problem()).toBeUndefined();
  });
});
