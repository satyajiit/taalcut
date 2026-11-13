// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT1: an id the model copied wrong is mended to the run's own; a valid id, or an unclear one, goes as it was. */
import { NotFoundError, type RunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { knownIds, mendIds, notFoundHint } from '../../src/context/id-repair';
import { initialState } from '../../src/run-state';

const BREAKDOWN = '01M6AB1W3T34N3T7Z89GD8PB4K';
const PROJECT = '01M6968FMZXYMX6EBXXKJ20P3T';

function stateWith(output: unknown) {
  const state = initialState('01RUN0000000000000000000000' as RunId);
  state.toolCallOrder.push('t1' as never);
  state.toolCalls['t1'] = {
    requested: { toolCallId: 't1', tool: 'templates.breakdown', input: { projectId: PROJECT } },
    outcome: { kind: 'completed', payload: { output: { kind: 'inline', value: output } } },
  } as never;
  return state;
}

describe('an id copied wrong', () => {
  const known = knownIds(stateWith({ breakdownId: BREAKDOWN }));

  it('knows the ids the run’s tools returned and were called with', () => {
    expect([...known].sort()).toEqual([BREAKDOWN, PROJECT].sort());
  });

  it('is mended to the one id within two edits (the 9B dropped a character)', () => {
    const sent = { breakdownId: BREAKDOWN.slice(0, -1), intents: [{ slotIndex: 0, text: 'a walk' }] };
    expect(mendIds(sent, known)).toEqual({
      input: { breakdownId: BREAKDOWN, intents: [{ slotIndex: 0, text: 'a walk' }] },
      mended: [{ from: BREAKDOWN.slice(0, -1), to: BREAKDOWN }],
    });
    expect(mendIds({ id: BREAKDOWN.toLowerCase() }, known)?.input).toEqual({ id: BREAKDOWN });
  });

  it('knows the run’s project and the ids in its message, before any tool ran (r1’s first call)', () => {
    const state = initialState('01RUN0000000000000000000000' as RunId);
    state.started = { projectId: PROJECT, message: `Copy ${BREAKDOWN}, please` } as never;
    const ids = knownIds(state);
    expect(mendIds({ projectId: `${PROJECT}Z` }, ids)?.input).toEqual({ projectId: PROJECT });
    expect(ids.has(BREAKDOWN)).toBe(true);
  });

  it('includes library asset ids from selections so mangled asset ids are repaired', () => {
    const ASSET = '01M6968FMZXYMX6EBXXKJ20A55';
    const state = initialState('01RUN0000000000000000000000' as RunId);
    state.started = {
      projectId: PROJECT,
      message: 'Use my selected clip',
      selections: [{ kind: 'asset', assetId: ASSET, name: 'ground_floor.mp4' }],
    } as never;
    const ids = knownIds(state);
    expect(ids.has(ASSET)).toBe(true);
    expect(mendIds({ assetId: ASSET.slice(0, -1) }, ids)?.input).toEqual({ assetId: ASSET });
  });

  it('is left alone when valid, far from every known id, or near two', () => {
    expect(mendIds({ breakdownId: BREAKDOWN, other: '01M6AB1W3T34N3T7Z89GD8PB99' }, known)).toBeUndefined();
    expect(mendIds({ breakdownId: 'ZZZZZZZZZZZZZZZZZZZZZZZZZ' }, known)).toBeUndefined();
    const twins = new Set([`${BREAKDOWN.slice(0, -1)}A`, `${BREAKDOWN.slice(0, -1)}B`]);
    expect(mendIds({ breakdownId: BREAKDOWN.slice(0, -1) }, twins)).toBeUndefined();
    expect(mendIds({ text: 'a person walks through a gateway at night' }, known)).toBeUndefined();
  });
});

/** EDT1-GFX: a valid id a tool didn't find is named in the refusal, with the one near id the run saw. */
describe('a not-found refusal', () => {
  const ITEM = '01M6BN2W91JE6KEW6VMB7T670N';
  const TIMELINE = '01M6BN6BSTEA5ZYR2JYCQVY6TT';
  const known = new Set([ITEM, TIMELINE]);
  const missing = (id: string) => NotFoundError({ entity: 'graphic', id });

  it('names the one id the run saw within one or two characters', () => {
    const oneOff = `${ITEM.slice(0, -1)}M`;
    expect(notFoundHint(missing(oneOff), known).detail).toBe(
      `No graphic has the id ${oneOff}. Did you mean ${ITEM}? It is the one id this run has seen within two characters of it.`,
    );
    expect(notFoundHint(missing(`${ITEM.slice(0, -2)}MM`), known).detail).toContain(`Did you mean ${ITEM}?`);
  });

  it('never guesses between two, or past two characters: it says what was not found', () => {
    const twins = new Set([`${ITEM.slice(0, -1)}P`, `${ITEM.slice(0, -1)}Q`]);
    const between = notFoundHint(missing(ITEM), twins).detail;
    expect(between).toBe(
      `No graphic has the id ${ITEM}. Pass each id exactly as the request or a tool gave it.`,
    );
    expect(notFoundHint(missing(`${ITEM.slice(0, -3)}MMM`), known).detail).not.toContain('Did you mean');
  });

  it('names no near id for an id the run saw (the 9B’s timeline id as the project), and keeps a tool’s own words', () => {
    const wrongKind = notFoundHint(NotFoundError({ entity: 'project', id: TIMELINE }), known);
    expect(wrongKind.detail).toBe(
      `No project has the id ${TIMELINE}. Pass each id exactly as the request or a tool gave it.`,
    );
    const own = NotFoundError({ entity: 'graphic', id: ITEM }, { detail: 'That graphic was removed.' });
    expect(notFoundHint(own, known)).toBe(own);
    const other = NotFoundError({ entity: 'artifact', id: 'notes.md' });
    expect(notFoundHint(other, known)).toBe(other);
  });
});
