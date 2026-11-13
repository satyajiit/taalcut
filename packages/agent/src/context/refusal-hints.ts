// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: what a refused call is told beyond the tool's own words, so the model can mend it (SPEC section 38).
 *
 * - A call outside the step's skill (`agent.outside_skill`) names the step's tools, or says to find them, instead of
 *   only "Use only X's tools".
 * - A file that isn't there (`media.file_not_found`): MLX1's 4B made up `/tmp/frames/<id>/frame_0.png` five times in
 *   one breakdown. When no tool of the step returned that path, the refusal says so and lists the paths they did.
 * - EDT1-GFX: an id a tool didn't find (`core.not_found`) says what wasn't found, and the one near id the run saw.
 */
import type { TaalcutError } from '@taalcut/core';
import type { RunContext } from '../context';
import { knownIds, notFoundHint } from './id-repair';
import { HAND_OFF_TOOL } from '../meta-tools';
import type { ToolCallState } from '../run-state';

/** Tools an outside-skill refusal lists before "…". */
const LISTED_TOOLS = 12;
/** Paths a file-not-found refusal lists, the newest first. */
const LISTED_PATHS = 3;
/** How deep into a tool's output the paths are looked for. */
const PATH_DEPTH = 5;
const FILE_PATH = /^(?:\/|[A-Za-z]:\\)[^\n]*\.[A-Za-z0-9]{2,5}$/u;

/** The outside-skill refusal's words: the step's tools by name, or how to find them. */
export function outsideSkillDetail(
  skill: {
    readonly id: string;
    readonly tools: { readonly names?: readonly string[]; readonly families?: readonly string[] };
  },
  allowed: (name: string) => boolean,
  tool: string,
): string {
  const names = [...(skill.tools.names ?? []).filter(allowed), HAND_OFF_TOOL];
  const listed = names.slice(0, LISTED_TOOLS).join(', ') + (names.length > LISTED_TOOLS ? ', …' : '');
  const families = skill.tools.families?.length
    ? ` Find its ${skill.tools.families.join(' and ')} tools with findTools.`
    : '';
  return `${tool} is not one of ${skill.id}'s tools. Use only these: ${listed || 'none named'}.${families}`;
}

function pathsIn(value: unknown, depth: number, into: string[]): void {
  if (depth < 0 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (FILE_PATH.test(value)) into.push(value);
    return;
  }
  if (Array.isArray(value)) for (const item of value) pathsIn(item, depth - 1, into);
  else if (typeof value === 'object')
    for (const item of Object.values(value as Record<string, unknown>)) pathsIn(item, depth - 1, into);
}

/** The file paths the current step's tools returned, newest first, without repeats. */
function returnedPaths(ctx: RunContext): string[] {
  const state = ctx.log.state;
  const ids = state.transcript.flatMap((item) =>
    item.kind === 'assistant' && item.step === state.stepIndex ? item.toolCallIds : [],
  );
  const found: string[] = [];
  for (const id of ids) {
    const outcome = state.toolCalls[id]?.outcome;
    if (outcome?.kind === 'completed' && outcome.payload.output.kind === 'inline')
      pathsIn(outcome.payload.output.value, PATH_DEPTH, found);
  }
  return [...new Set(found.reverse())];
}

const inputPath = (input: unknown): string | undefined => {
  const path = input !== null && typeof input === 'object' ? (input as { path?: unknown }).path : undefined;
  return typeof path === 'string' ? path : undefined;
};

/** The error with a hint the model can act on, or the error as it was. */
export function withRefusalHint(ctx: RunContext, call: ToolCallState, error: TaalcutError): TaalcutError {
  // EDT1-GFX: an id a tool didn't find says which, and the near one the run saw (id-repair.ts).
  if (error.code === 'core.not_found') return notFoundHint(error, knownIds(ctx.log.state));
  if (error.code !== 'media.file_not_found') return error;
  const path = inputPath(call.requested.input);
  const returned = returnedPaths(ctx);
  if (path === undefined || returned.includes(path)) return error;
  const listed = returned.slice(0, LISTED_PATHS);
  const hint =
    listed.length > 0
      ? `No tool returned this path. Paths this step's tools returned: ${listed.join(', ')}. Pass one exactly as returned.`
      : 'No tool returned this path: pass a path exactly as a tool returned it, never one made up.';
  return { ...error, detail: `${error.detail ?? ''} ${hint}`.trim() };
}
