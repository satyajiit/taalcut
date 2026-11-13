// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the edit eval. Its cases cover every family, "this" and "here", and asks of more than one change; a
 * scripted Editor that does what a case asks passes its checker, one that also changes something else is caught as
 * out of target, and a call that doesn't fit its tool counts as malformed. The recorded sessions of the 9B on MLX
 * replay to the verdicts they were recorded with. Whether a live run meets the bar is the live run's report: the
 * 9B samples, so CI checks that the tools and checkers still give each recorded run its verdict.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createScriptedModelClient, type ScriptedReply } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { EDIT_FAMILIES } from '../../src/edit/case-types';
import { EDIT_CASES } from '../../src/edit/cases';
import { loadSession, SESSIONS_DIR } from '../../src/edit/cli';
import { editReport } from '../../src/edit/report';
import { runCase, type CaseRun } from '../../src/edit/run';
import { IDS, PROJECT_ID, TIMELINE_ID } from '../../src/edit/timeline-doc';

const target = { projectId: PROJECT_ID, timelineId: TIMELINE_ID };
const byId = (id: string) => EDIT_CASES.find((edit) => edit.id === id)!;
const call = (name: string, args: Record<string, unknown>): ScriptedReply => ({
  toolCalls: [{ name, arguments: args }],
});

/** The Editor's turns in order (a docked run has no planning turn: the Editor's is the first). */
function editor(...replies: ScriptedReply[]) {
  return createScriptedModelClient((_request, turn) => replies[Math.min(turn, replies.length - 1)]!);
}

describe('the edit eval (EDT1-OPS)', () => {
  it('has at least 40 cases across every family, with "this", "here" and asks of several changes', () => {
    expect(EDIT_CASES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(EDIT_CASES.map((edit) => edit.id)).size).toBe(EDIT_CASES.length);
    for (const family of EDIT_FAMILIES) expect(EDIT_CASES.some((edit) => edit.family === family)).toBe(true);
    expect(EDIT_CASES.filter((edit) => edit.pointed && edit.select).length).toBeGreaterThanOrEqual(10);
    expect(EDIT_CASES.filter((edit) => edit.pointed && !edit.select).length).toBeGreaterThanOrEqual(4);
    expect(EDIT_CASES.filter((edit) => edit.family === 'multi').length).toBeGreaterThanOrEqual(5);
  });

  it('passes an Editor that does what was asked, and reports its calls', async () => {
    const { run } = await runCase(byId('multi-this-half-crossfade'), {
      live: editor(
        call('timeline_get', { timelineId: TIMELINE_ID }),
        // EDT1-OPS: "this", which the tools read from what the person pointed at, and the same clip by its number.
        call('timeline_setSpeed', { ...target, clip: 'this', speed: 0.5 }),
        call('timeline_setTransition', { ...target, clip: 1, edge: 'end', kind: 'dissolve' }),
        {
          text: 'Clip 1 now plays at half speed, with a crossfade into clip 2.',
          ...call('handOff', { timelineId: TIMELINE_ID, revision: 5 }),
        },
        { text: 'Done.' },
      ),
    });
    expect(run, run.why).toMatchObject({ pass: true, outOfTarget: [], malformed: [], status: 'completed' });
    expect(run.calls.map((entry) => entry.tool)).toEqual([
      'timeline.get',
      'timeline.setSpeed',
      'timeline.setTransition',
      'handOff',
    ]);
    expect(run.said).toMatch(/half speed/);
  });

  it('reports the run failure when no evaluated model is available', async () => {
    const { run } = await runCase(byId('multi-this-half-crossfade'), {});
    expect(run).toMatchObject({ pass: false, status: 'failed', calls: [], turns: 0 });
    expect(run.why).toContain('run failed: models.unavailable: the recorded session has no more turns');
  });

  it('fails an Editor that also changed what the request was not about', async () => {
    const { run } = await runCase(byId('colour-this-mono'), {
      live: editor(
        call('timeline_get', { timelineId: TIMELINE_ID }),
        // The guard refuses a clip away from the selection once (pointing-guard.ts); the repeat goes through.
        call('timeline_setGrade', { ...target, clips: [2, 3], look: 'mono' }),
        call('timeline_setGrade', { ...target, clips: [2, 3], look: 'mono' }),
        call('handOff', { timelineId: TIMELINE_ID, revision: 4 }),
        { text: 'Done.' },
      ),
    });
    expect(run.pass).toBe(false);
    expect(run.outOfTarget).toEqual([`clip ${IDS.clips[2]} changed`]);
  });

  it('fails a structural edit that moved a clip around its target, and passes the target moved', async () => {
    const move = (clip: number) =>
      editor(
        call('timeline_get', { timelineId: TIMELINE_ID, atSeconds: 0 }),
        call('timeline_moveClip', { ...target, clip: String(clip), to: 'start' }),
        call('handOff', { timelineId: TIMELINE_ID, revision: 4 }),
        { text: 'Done.' },
      );
    // Run 9: "open on the skyline", and the dog (clip 5) went to the start.
    const wrong = (await runCase(byId('move-named-to-start'), { live: move(5) })).run;
    expect(wrong.pass).toBe(false);
    expect(wrong.outOfTarget).toEqual([
      'the clips around the target changed order: bike,coffee,crossing,waves,dog became dog,bike,coffee,crossing,waves',
    ]);
    const right = (await runCase(byId('move-named-to-start'), { live: move(6) })).run;
    expect(right).toMatchObject({ pass: true, outOfTarget: [] });
  });

  it('fails a run that asked for a graphic for a text it was to move, and reports it apart from out of target', async () => {
    // Run 11: "move the Weekend ride title down" became a proposed lower third. Now (HFW1) it would be a job for the
    // Designer, whose design is a proposal: the committed video didn't change, so a fail, not out of target, counted
    // as proposed.
    const { run } = await runCase(byId('text-move-title'), {
      live: editor(
        call('timeline_get', { timelineId: TIMELINE_ID, atSeconds: 0 }),
        call('graphics_design', {
          projectId: target.projectId,
          timelineId: TIMELINE_ID,
          request: 'Move the Weekend ride title down near the bottom of the frame.',
          at: 0,
        }),
        call('handOff', { timelineId: TIMELINE_ID, revision: 3 }),
        { text: 'Done.' },
      ),
    });
    expect(run.calls.map((entry) => `${entry.tool}${entry.ok ? '' : ` ✗ ${entry.error}`}`)).toContain(
      'graphics.design',
    );
    expect(run).toMatchObject({ pass: false, outOfTarget: [] });
    expect(run.proposed).toHaveLength(1);
    const report = editReport('scripted', 'replay', [run]);
    expect(report).toMatchObject({ outOfTarget: 0, proposedUnasked: 1 });
  });

  it('scopes a transition by its cut: "into the next one" on the next clip’s cut is out of target', async () => {
    const fade = (clip: string, times = 1) =>
      editor(
        call('timeline_get', { timelineId: TIMELINE_ID, atSeconds: 0 }),
        ...Array.from({ length: times }, () =>
          call('timeline_setTransition', {
            ...target,
            clip,
            edge: 'end',
            kind: 'dissolve',
            durationSeconds: 0.5,
          }),
        ),
        call('handOff', { timelineId: TIMELINE_ID, revision: 4 }),
        { text: 'Done.' },
      );
    // Run 11: the bike selected, and the crossfade went on the coffee to crossing cut (clip 2's end). The guard
    // refuses it once; sent again, it goes through and is out of target.
    const wrong = (await runCase(byId('transition-this-crossfade-next'), { live: fade('2', 2) })).run;
    expect(wrong.calls.find((entry) => entry.tool === 'timeline.setTransition')).toMatchObject({
      ok: false,
      error: 'timeline.invalid_move',
    });
    expect(wrong.pass).toBe(false);
    expect(wrong.outOfTarget).toEqual([`the transition ${IDS.clips[1]}>${IDS.clips[2]} changed`]);
    const right = (await runCase(byId('transition-this-crossfade-next'), { live: fade('this') })).run;
    expect(right).toMatchObject({ pass: true, outOfTarget: [] });
  });

  it('counts a call that does not fit its tool as malformed', async () => {
    const { run } = await runCase(byId('sound-this-mute'), {
      live: editor(
        call('audio_setVolume', { ...target, of: { kind: 'clips', clips: ['this'] }, muted: 'yes' }),
        call('audio_setVolume', { ...target, of: { kind: 'clips', clips: ['this'] }, muted: true }),
        call('handOff', { timelineId: TIMELINE_ID, revision: 4 }),
        { text: 'Done.' },
      ),
    });
    expect(run.pass).toBe(true);
    expect(run.malformed).toEqual([
      expect.objectContaining({
        tool: 'audio.setVolume',
        ok: false,
        error: 'tools.invalid_input',
        input: expect.objectContaining({ muted: 'yes' }),
      }),
    ]);
  });

  const recorded = existsSync(SESSIONS_DIR)
    ? readdirSync(SESSIONS_DIR).filter((name) => name.endsWith('.json'))
    : [];

  it.skipIf(recorded.length === 0)(
    'replays every recorded session to its verdict',
    async () => {
      const runs: CaseRun[] = [];
      for (const edit of EDIT_CASES) {
        const session = loadSession(edit.id);
        expect(session, `no recorded session for ${edit.id}`).toBeDefined();
        const { run } = await runCase(edit, { replay: session! });
        expect({ id: edit.id, pass: run.pass }).toEqual({ id: edit.id, pass: session!.verdict.pass });
        runs.push(run);
      }
      const report = editReport(loadSession(EDIT_CASES[0]!.id)!.model, 'replay', runs);
      expect(report.nonGraphics.n).toBe(EDIT_CASES.filter((edit) => edit.family !== 'graphics').length);
    },
    600_000,
  );
});
