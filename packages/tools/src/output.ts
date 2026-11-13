// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Large outputs go to the artifact store and the model gets a reference plus
 * a short summary (PRD 7.2, "Context economy").
 */
import { toolCallSummary, type AnyTool, type ArtifactStore } from '@taalcut/core';
import type { ToolOutput } from './ports';

/** About 2k tokens of JSON. Above this, outputs are stored as artifacts. */
export const DEFAULT_INLINE_OUTPUT_LIMIT = 8 * 1024;
/** A summary is a sentence or two for the model, not a second copy of the output. */
const MAX_SUMMARY = 500;

export async function toToolOutput(
  spec: AnyTool,
  value: unknown,
  artifacts: ArtifactStore | undefined,
  inlineLimit: number,
): Promise<ToolOutput> {
  const json = JSON.stringify(value) ?? 'null';
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= inlineLimit || !artifacts) return { kind: 'inline', value };
  const summary = summarise(spec, value, bytes);
  const stored = await artifacts.put({ mediaType: 'application/json', data: json, summary });
  // If the store fails, the model still gets the value: correctness over context size.
  return stored.ok ? { kind: 'artifact', ref: stored.value } : { kind: 'inline', value };
}

/**
 * The default names the tool and the size and quotes none of the output: the
 * output may hold text from a file, a web page or a video, and the summary is
 * read by the model outside any untrusted-data wrapper the agent puts around
 * marked fields. A tool's own summary is kept, with tag-shaped text defused.
 */
function summarise(spec: AnyTool, value: unknown, bytes: number): string {
  if (typeof spec.summarize !== 'function')
    return `${spec.name} returned ${bytes} bytes of JSON, stored as an artifact.`;
  const text = defuseTags(String(spec.summarize(value)));
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY)}…` : text;
}

/**
 * Replaces the `<` of anything that looks like a tag (`<untrusted`,
 * `</tool-result>`, `<system>`) with `‹`, so a summary built from tool output
 * can't open or close the agent's wrappers.
 */
export function defuseTags(text: string): string {
  // Invisible format characters (U+200B and the like) first, so `<\u200b/untrusted>` can't slip through.
  return text.replace(/\p{Cf}/gu, '').replace(/<(?=\s*[/!?]?\s*[A-Za-z])/g, '‹');
}

/**
 * FIX-TOOLGROUPS: the tool's own words for the call, for people ("IMG_0412.MOV · 0:48"), as one bounded line. A tool
 * that says nothing, or throws saying it, leaves the result without a summary: the call itself went fine.
 */
export function callSummary(spec: AnyTool, input: unknown, value: unknown): { summary?: string } {
  if (typeof spec.describeCall !== 'function') return {};
  try {
    const summary = toolCallSummary(spec.describeCall(input, value));
    return summary ? { summary } : {};
  } catch {
    return {};
  }
}
