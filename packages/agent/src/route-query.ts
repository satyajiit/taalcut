// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: a step is routed on what it needs, not on its skill's fixed description. A flow step has no text of its own,
 * so every make loaded the same five tools whatever the fixes asked for (the make flow's Editor, sent a reframe fix,
 * had no timeline.setReframe loaded). The query is now the step's input: a request's words, and each fix's command
 * and words (a QA fix, a slot-match fix: they name the slot, what differs and the tools that can fix it), then the
 * step's text and the skill's description. Each tool a fix names loads first. Pure over the step's input, so a
 * resumed run and a replay route alike.
 */
import type { AnySkill } from '@taalcut/core';
import { commentRouteWords } from './comments/comment-request';
import type { RunState, StepState } from './run-state';

type Facts = Record<string, unknown>;
const record = (value: unknown): Facts =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Facts) : {};

/** A tool name as a fix writes it (timeline.setReframe). */
const TOOL_NAME = /\b[a-z][a-z0-9]{1,30}\.[a-z][a-zA-Z0-9]{1,40}\b/g;
/** The most words of a request or of fixes the query takes: enough to route, short enough to log. */
const NEED_CHARS = 600;

/** The fixes in a step's input (QA's fix shape), each as an object. */
function fixesIn(input: unknown): Facts[] {
  const fixes = record(input).fixes;
  return Array.isArray(fixes) ? fixes.map(record) : [];
}

/** camelCase and dotted keys as words: qa.fix.swapFromAlternates is "qa fix swap from alternates". */
const words = (text: string) => text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ');

/** A fix's words: its command, its instruction, and its params' strings (ids are short, numbers are left out). */
function fixWords(fix: Facts): string {
  const params = Object.values(record(fix.params)).filter(
    (value): value is string => typeof value === 'string',
  );
  return [fix.command, fix.instructionKey, fix.labelKey, ...params]
    .filter((part): part is string => typeof part === 'string')
    .map(words)
    .join(' ');
}

/**
 * What the step's input asks for, in words: its request (unless the step's text says it already: a docked message's
 * step), then its fixes. Empty when it asks for nothing.
 */
export function needWords(input: unknown, withRequest = true): string {
  const request = record(input).request;
  const asked = withRequest && typeof request === 'string' ? request : '';
  const fixes = fixesIn(input).map(fixWords).join(' ');
  return `${asked} ${fixes}`.replace(/\s+/g, ' ').trim().slice(0, NEED_CHARS);
}

/** The tools the step's fixes name (a command fix's command, a tool named in an agent fix's params), in order. */
export function fixTools(input: unknown): string[] {
  const named = fixesIn(input).flatMap((fix) => {
    const params = Object.values(record(fix.params)).filter(
      (value): value is string => typeof value === 'string',
    );
    return [
      ...(typeof fix.command === 'string' ? [fix.command] : []),
      ...params.flatMap((value) => value.match(TOOL_NAME) ?? []),
    ];
  });
  return [...new Set(named)];
}

/** The tools a route query names by their full names (a skill's description that names its loop's), in order. */
export function queryTools(query: string): string[] {
  return [...new Set(query.match(TOOL_NAME) ?? [])];
}

/**
 * The step's route query: a comment batch's words (FIX-CMT); otherwise what its input needs, its text and its
 * skill's description.
 */
export function routeQuery(
  state: RunState,
  step: Pick<StepState, 'id' | 'input' | 'text'>,
  skill: AnySkill,
  input: unknown,
): string {
  const comments = commentRouteWords(state, step);
  if (comments) return comments;
  const need = needWords(input, step.text.trim() === '');
  return `${need} ${skill.description} ${step.text}`.replace(/\s+/g, ' ').trim();
}
