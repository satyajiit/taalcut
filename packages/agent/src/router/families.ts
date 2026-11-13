// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tool families the router chooses from: one line per family (spike 04's question shape, about 160
 * tokens of options), taken from this table for the families Taalcut ships and from the tools' own summaries
 * for any other, so a family a domain package adds reaches the router with no change here. Model-facing text,
 * not user-facing copy.
 */
import type { ToolCatalogueEntry, ToolRegistry } from '@taalcut/tools';
import { META_TOOLS } from '../meta-tools';
import type { RouteFamily } from './router-port';

export const NONE_FAMILY = 'none';
export const NONE_DESCRIPTION =
  'No tool. Chat, taste, definitions, clarifying questions, or a refusal to act.';

export const FAMILY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  library: 'Add footage, search the library, open an asset, or check an import.',
  media: 'Inspect a file, conform it, or build editorial proxies.',
  vision: 'Read a frame, find cuts, read on-screen text, score shot quality, or index looks.',
  audio: 'Beats, a speech transcript, loudness, voice or music of a track; hear and describe sounds.',
  templates: 'Take in a reference, break it down, or save and list templates.',
  timeline: 'Assemble, trim, reorder, retitle, swap, cast, fill or drop slots, or grab a still.',
  render: 'Preview, caption, check, or export the finished video.',
  sandbox: 'Run a custom script that is not one of the named tools.',
  workspace:
    'Author, edit, delete, move, search, lint, render or place HyperFrames compositions, or run the sandbox shell.',
  images: 'Generate a still image for a slot.',
  graphics:
    'Add or edit motion graphics (lower thirds, callouts, counters, lists, kinetic titles, bar charts, word swaps, calls to action) and how they move.',
  captions: 'Enable, edit, restyle, rebuild or translate captions.',
  translation: 'Translate captions or on-screen text into another language.',
  comments: 'List or reply to review comments on the timeline.',
  memory: 'Recall or save creator preferences and project notes.',
  voice: 'Write and place a voiceover.',
  soul: 'Change how the assistant talks (tone, detail), when the user asks for a lasting change.',
};

/** Tool-name prefixes mapped to their canonical router family when resolved by prefix. */
export const FAMILY_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  library: ['library.'],
  media: ['media.'],
  vision: ['vision.'],
  audio: ['audio.'],
  templates: ['templates.'],
  timeline: ['timeline.'],
  render: ['render.'],
  sandbox: ['sandbox.'],
  workspace: ['workspace.'],
  images: ['image.', 'images.'],
  graphics: ['graphics.'],
  captions: ['captions.'],
  translation: ['captions.translate', 'translation.'],
  comments: ['comments.'],
  memory: ['memory.'],
  music: ['music.'],
  sfx: ['sfx.'],
  voice: ['voice.'],
  video: ['video.'],
  soul: ['soul.'],
};

const MAX_DESCRIPTION = 160;
const MAX_TOOL_LINES = 2_000;

/** The families of these catalogue entries, each with its line and its tools' one-liners. */
export function routeFamilies(entries: readonly ToolCatalogueEntry[]): RouteFamily[] {
  const byFamily = new Map<string, ToolCatalogueEntry[]>();
  for (const entry of entries) byFamily.set(entry.family, [...(byFamily.get(entry.family) ?? []), entry]);
  return [...byFamily]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, tools]) => ({
      id,
      description: (FAMILY_DESCRIPTIONS[id] ?? tools.map((t) => t.summary).join(' ')).slice(
        0,
        MAX_DESCRIPTION,
      ),
      tools: tools
        .map((t) => `${t.name}: ${t.summary}`)
        .join('\n')
        .slice(0, MAX_TOOL_LINES),
    }));
}

function prefixFamilyOf(name: string): string | undefined {
  const canonical = name.replace(/_/g, '.');
  for (const [family, prefixes] of Object.entries(FAMILY_PREFIXES)) {
    if (prefixes.some((prefix) => canonical.startsWith(prefix) || name.startsWith(prefix))) return family;
  }
  return undefined;
}

/** The family a call goes to: 'none' for the pseudo-tools (findTools, handOff…) and for unknown names. */
export function familyOfCall(registry: Pick<ToolRegistry, 'resolve'>, name: string): string {
  if (META_TOOLS.includes(name)) return NONE_FAMILY;
  return registry.resolve(name)?.descriptor.family ?? prefixFamilyOf(name) ?? NONE_FAMILY;
}

/** The main model's family for a turn: its first domain tool call's, or 'none' when it called none. */
export function mainFamily(
  registry: Pick<ToolRegistry, 'resolve'>,
  calls: readonly { readonly name: string }[],
): string {
  for (const call of calls) {
    const family = familyOfCall(registry, call.name);
    if (family !== NONE_FAMILY) return family;
  }
  return NONE_FAMILY;
}
