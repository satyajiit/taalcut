// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: the stand-in's docked designed graphic (src/edit-design-script.ts), turn by turn. The Editor reads the
 * graphics, records the job for the Designer at 0:04 and hands off without changing anything; the Designer writes the
 * headline's file, checks it, reads the revision, proposes it at the job's second and hands the job off as placed.
 * Its ask is its own session's, apart from the make flow's and edit-chat's.
 */
import { describe, expect, it } from 'vitest';
import {
  EDIT_CHAT_SESSION,
  EDIT_DESIGN_ASK,
  EDIT_DESIGN_ENTRY,
  EDIT_DESIGN_NAME,
  EDIT_DESIGN_PROPOSED,
  EDIT_DESIGN_SESSION,
  editDesignTurn,
  isEditChatAsk,
  isEditDesignAsk,
  isMakeFlowAsk,
  type RequestView,
} from '../src/index';

type Call = RequestView['calls'][number];
const editor = (calls: Call[]): RequestView => ({
  ask: EDIT_DESIGN_ASK,
  skill: 'timeline.editor',
  input: { projectId: 'P', timelineId: 'T' },
  calls,
  tools: ['graphics_list', 'graphics_design', 'graphics_edit', 'graphics_remove', 'handOff'],
});
const designer = (calls: Call[]): RequestView => ({
  ask: EDIT_DESIGN_ASK,
  skill: 'render.designer',
  input: { projectId: 'P', timelineId: 'T', jobs: [{ jobId: 'job-1', request: EDIT_DESIGN_ASK, at: 4 }] },
  calls,
  tools: ['workspace_write', 'workspace_lint', 'workspace_place', 'graphics_list', 'handOff'],
});
const done = (name: string, result: object): Call => ({ name, input: {}, result: JSON.stringify(result) });
const listed = done('graphics_list', { revision: 4, items: [] });

describe('the docked designed graphic’s stand-in (HFW1-UI)', () => {
  it('the Editor reads the graphics, records the job at 0:04 and hands off the same revision', () => {
    expect(editDesignTurn(editor([])).toolCall).toEqual({ name: 'graphics_list', args: { timelineId: 'T' } });
    expect(editDesignTurn(editor([listed])).toolCall).toEqual({
      name: 'graphics_design',
      args: { projectId: 'P', timelineId: 'T', request: EDIT_DESIGN_ASK, at: 4 },
    });
    const recorded = done('graphics_design', { jobId: 'job-1', note: 'Recorded.' });
    expect(editDesignTurn(editor([listed, recorded])).toolCall).toEqual({
      name: 'handOff',
      args: { timelineId: 'T', revision: 4 },
    });
  });

  it('the Designer writes, checks, places at the job’s second and hands the job off as placed', () => {
    const write = editDesignTurn(designer([])).toolCall!;
    expect(write.name).toBe('workspace_write');
    expect(write.args).toMatchObject({ projectId: 'P', path: EDIT_DESIGN_ENTRY });
    expect(String(write.args.text)).toContain('data-composition-id="headline"');
    const wrote = done('workspace_write', { path: EDIT_DESIGN_ENTRY, revision: 3, bytes: 900 });
    expect(editDesignTurn(designer([wrote])).toolCall).toEqual({
      name: 'workspace_lint',
      args: { projectId: 'P', entry: EDIT_DESIGN_ENTRY },
    });
    const failed = done('workspace_lint', { passed: false, findings: [{ code: 'x' }] });
    expect(editDesignTurn(designer([wrote, failed])).text).toMatch(/didn’t pass its checks/);
    const linted = done('workspace_lint', { passed: true, findings: [] });
    expect(editDesignTurn(designer([wrote, linted])).toolCall?.name).toBe('graphics_list');
    expect(editDesignTurn(designer([wrote, linted, listed])).toolCall).toEqual({
      name: 'workspace_place',
      args: {
        projectId: 'P',
        timelineId: 'T',
        revision: 4,
        entry: EDIT_DESIGN_ENTRY,
        name: EDIT_DESIGN_NAME,
        request: EDIT_DESIGN_ASK,
        at: 4,
      },
    });
    const placed = done('workspace_place', { revision: 5, itemIds: ['I'], compositionId: 'C' });
    expect(editDesignTurn(designer([wrote, linted, listed, placed])).toolCall).toEqual({
      name: 'handOff',
      args: {
        timelineId: 'T',
        revision: 5,
        results: [{ jobId: 'job-1', outcome: 'placed', itemIds: ['I'], compositionId: 'C' }],
      },
    });
  });

  it('the run’s last turn says what was done', () => {
    expect(editDesignTurn({ ...editor([]), skill: null }).text).toBe(EDIT_DESIGN_PROPOSED);
  });

  it('its ask is its own session’s', () => {
    expect(isEditDesignAsk(`Change this: ${EDIT_DESIGN_ASK}`)).toBe(true);
    expect(isEditChatAsk(EDIT_DESIGN_ASK)).toBe(false);
    expect(isMakeFlowAsk(EDIT_DESIGN_ASK)).toBe(false);
    expect(EDIT_DESIGN_SESSION.name).not.toBe(EDIT_CHAT_SESSION.name);
    expect(EDIT_DESIGN_SESSION.asks).toEqual([EDIT_DESIGN_ASK]);
  });
});
