// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-T5 replayed: recorded Analyst sessions (the model's tool calls,
 * describeFrame answers and handoffs, test/fixtures/analyst-sessions.json)
 * run offline against the real tools on a synthetic reel. Every call must be
 * inside the skill's tool subset, every frame it looks at must exist, a call
 * recorded as refused is refused with that code, and the second method
 * decides each handoff as recorded. The pages are sized for the window the
 * sessions were recorded at (LRN1-CTX), and each page must hold the slots it
 * did then: a change to the page rule fails here until they are re-recorded.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { newId, type RunId, type SkillContext } from '@taalcut/core';
import { analystOutputSchema, analystSkill } from '../../src/index';
import { runProcess, SYNTHETIC_REELS, syntheticReelArgs } from '../../src/test-support';
import { fakeYtDlp } from '../helpers/fake-fetcher';
import { findFfmpeg } from '../helpers/ffmpeg';
import { setupTools, type ToolSetup } from '../helpers/tool-setup';

interface Turn {
  readonly tool?: string;
  readonly input?: unknown;
  readonly as?: string;
  readonly recorded?: unknown;
  /** The error code the call answers with (a refusal the session recovers from). */
  readonly fails?: string;
  /** The slots a templates.resolveCuts call answered with when recorded. */
  readonly page?: readonly number[];
  readonly handOff?: unknown;
  readonly expect?: { readonly verdict: string; readonly reasonIncludes?: readonly string[] };
}
interface Session {
  readonly name: string;
  readonly turns: readonly Turn[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/analyst-sessions.json', import.meta.url), 'utf8'),
) as { contextWindow: number; sessions: Session[] };
const pageSchema = z.object({ slots: z.array(z.object({ index: z.number() })) });
const { bins, skip } = findFfmpeg('analyst sessions');
const work = mkdtempSync(join(tmpdir(), 'taalcut-analyst-'));
const reel = join(work, 'hard-cuts.mp4');
let setup: ToolSetup | undefined;

beforeAll(async () => {
  if (!bins) return;
  const made = await runProcess(bins.ffmpeg, syntheticReelArgs(SYNTHETIC_REELS[0]!, reel));
  if (!made.ok) throw new Error(made.error.detail);
});
afterEach(() => setup?.cleanup());
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** '$a.b.0' strings become values saved from earlier calls; everything else stays. */
function resolve(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const found = value
      .slice(1)
      .split('.')
      .reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], vars);
    if (found === undefined) throw new Error(`recording refers to ${value}, which no call returned`);
    return found;
  }
  if (Array.isArray(value)) return value.map((item) => resolve(item, vars));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, vars)]));
  return value;
}

describe.skipIf(!bins)('recorded Analyst sessions', () => {
  it.each(fixture.sessions.map((session) => [session.name, session] as const))(
    '%s',
    async (_name, session) => {
      setup = setupTools({ bins: bins!, run: fakeYtDlp(reel), contextWindow: fixture.contextWindow });
      const skill = analystSkill({ service: setup.service, sandbox: setup.sandbox });
      const allowed = (tool: string) =>
        (skill.tools.names ?? []).includes(tool) ||
        (skill.tools.families ?? []).some((family) => tool.startsWith(`${family}.`));
      const ctx: SkillContext = {
        runId: newId<'AgentRun'>() as RunId,
        projectId: setup.projectA,
        flowId: null,
        stepId: 'analyst',
        signal: new AbortController().signal,
      };
      const vars: Record<string, unknown> = { projectId: setup.projectA };

      for (const [index, turn] of session.turns.entries()) {
        const where = `turn ${index}`;
        if (turn.handOff !== undefined) {
          const output = analystOutputSchema.parse(resolve(turn.handOff, vars));
          const verdict = await skill.verify!(output, ctx);
          expect(verdict.ok, where).toBe(true);
          if (!verdict.ok) continue;
          expect(verdict.value.verdict, `${where}: ${JSON.stringify(verdict.value)}`).toBe(
            turn.expect?.verdict,
          );
          for (const part of turn.expect?.reasonIncludes ?? [])
            expect(verdict.value.verdict !== 'pass' && verdict.value.reason, where).toContain(part);
          if (verdict.value.verdict === 'pass') {
            const card = await skill.card!(output, ctx);
            expect(card.ok && card.value?.type, where).toBe('breakdown');
          }
          continue;
        }
        const tool = turn.tool!;
        expect(allowed(tool), `${where}: ${tool} is outside the Analyst's tools`).toBe(true);
        const input = resolve(turn.input, vars) as Record<string, unknown>;
        if (tool === 'vision.describeFrame') {
          // The vision lane answers in the app; here the recorded answer stands in. The frame must be there.
          expect(existsSync(String(input.path)), `${where}: ${String(input.path)}`).toBe(true);
          continue;
        }
        const result = await setup.call(tool, input);
        if (turn.fails !== undefined) {
          expect(result.ok || result.error.code, `${where} ${tool}`).toBe(turn.fails);
          continue;
        }
        if (!result.ok)
          throw new Error(`${where} ${tool}: ${result.error.code} ${result.error.detail ?? ''}`);
        if (turn.page !== undefined)
          expect(
            pageSchema.parse(result.value).slots.map((slot) => slot.index),
            `${where} page`,
          ).toEqual(turn.page);
        if (turn.as) vars[turn.as] = result.value;
      }
      // Analyse and discard: whatever the session did, no experiment is left.
      expect(setup.sandbox.openIds().filter((id) => existsSync(join(setup!.sandbox.root, id)))).toEqual([]);
    },
  );
});

if (skip) it.skip(skip, () => undefined);
