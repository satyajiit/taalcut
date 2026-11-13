// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CMT: what findTools loads. It ranks the tools the step may call, not the whole catalogue's best few: in a skill
 * step the global top twenty had crowded out the very tool the model named. A tool named exactly in the query (its
 * name, timeline.slipClip, or the call name the model sees, timeline_slipClip) comes first; a family's word
 * ("graphics", "captions", "audio") brings that family's tools next; the rest are ranked by the search. A name the
 * step may not call is said in one line, so the model stops searching for it. Pure over the registry.
 */
import { tokenize, type ToolCatalogueEntry, type ToolRegistry } from '@taalcut/tools';

/** A tool name as a model writes it: family, then a dot or (the call name) an underscore, then the tool. */
const NAME = /\b([a-z][a-z0-9]{1,30})[._]([a-z][a-zA-Z0-9]{1,40})\b/g;
/** Built-in camelCase meta-tools models sometimes pass to findTools (e.g. "startFlow" or "+startFlow"). */
const META_NAME = /\+?\b(startFlow|handOff|askUser|updatePlan|readArtifact)\b/g;

/** Discovery and prompt fitting must interpret quoted, punctuated and combined control names alike. */
export const queriedMetaTools = (query: string): string[] => [
  ...new Set([...query.matchAll(META_NAME)].map((match) => match[1]!)),
];

export interface FoundTools {
  /** The tools to load, best first, at most the limit. */
  readonly hits: readonly ToolCatalogueEntry[];
  /** Names the query gave exactly that the step may not call (or that no tool has), in the query's order. */
  readonly refused: readonly string[];
  /** Of `refused`, the ones no tool has. */
  readonly unknown: readonly string[];
  /** Built-in camelCase meta-tool names mentioned in the query, in order. */
  readonly meta: readonly string[];
}

export function findTools(
  query: string,
  registry: Pick<ToolRegistry, 'search' | 'catalogue'>,
  allowed: (name: string) => boolean,
  limit: number,
): FoundTools {
  const catalogue = registry.catalogue();
  const byName = new Map(catalogue.map((entry) => [entry.name, entry]));
  const families = new Set(catalogue.map((entry) => entry.family));
  const named: string[] = [];
  const refused: string[] = [];
  const unknown: string[] = [];
  const meta = queriedMetaTools(query);
  for (const match of query.matchAll(NAME)) {
    const [written, family] = [match[0], match[1]!];
    const name = byName.has(written) ? written : written.replace('_', '.');
    if (byName.has(name)) {
      (allowed(name) ? named : refused).push(name);
    } else if (families.has(family)) {
      // A dotted word of a family no tool has (a file name, "beach.mov") isn't a tool's name.
      refused.push(name);
      unknown.push(name);
    }
  }
  const stripped = query.replace(META_NAME, ' ');
  // The rest of the query's words, for the families: "graphics" outside a name ("graphics.list") is the family.
  const words = new Set(tokenize(stripped.replace(NAME, ' ')));
  const ranked =
    stripped.trim().length === 0
      ? []
      : registry
          .search(stripped, { limit: catalogue.length })
          .map((hit) => hit.name)
          .filter(allowed);
  const familyTools = catalogue
    .filter((entry) => allowed(entry.name) && tokenize(entry.family).some((word) => words.has(word)))
    .map((entry) => entry.name)
    // The search's order within the family; a tool it didn't score keeps the catalogue's.
    .sort((a, b) => rank(ranked, a) - rank(ranked, b));
  const names = [...new Set([...named, ...familyTools, ...ranked])].slice(0, limit);
  return {
    hits: names.map((name) => byName.get(name)!),
    refused: [...new Set(refused)],
    unknown: [...new Set(unknown)],
    meta: [...new Set(meta)],
  };
}

const rank = (ranked: readonly string[], name: string) => {
  const at = ranked.indexOf(name);
  return at < 0 ? ranked.length : at;
};

/** Availability hints when a query asks findTools for built-in camelCase meta-tools. */
export function metaLines(found: Pick<FoundTools, 'meta'>, skill?: string): string[] {
  return found.meta.map((name) => {
    switch (name) {
      case 'startFlow':
        return 'startFlow: only available in the initial planning turn before a step starts; continue using domain tools directly.';
      case 'handOff':
        return skill
          ? `handOff: already offered in ${skill}; call it directly once your work is done.`
          : 'handOff: only available inside a skill step; in a plain step, reply with your summary without calling tools when done.';
      case 'askUser':
        return 'askUser: only available inside a skill step that declares questions; it cannot be loaded via findTools.';
      case 'updatePlan':
        return 'updatePlan: already offered as a built-in planning tool; call it directly without findTools.';
      default:
        return 'readArtifact: already offered as a built-in artifact reader; call it directly without findTools.';
    }
  });
}

/** The one line for names the step may not call: which, and that searching again won't load them. */
export function refusedLine(found: FoundTools, skill: string | undefined): string | undefined {
  if (found.refused.length === 0) return undefined;
  const unknown = found.refused.filter((name) => found.unknown.includes(name));
  const outside = found.refused.filter((name) => !found.unknown.includes(name));
  const parts = [
    ...(outside.length > 0
      ? [
          `${list(outside)} ${outside.length > 1 ? 'are' : 'is'} not among ${skill ? `${skill}'s tools in this step` : 'the tools you can call'}`,
        ]
      : []),
    ...(unknown.length > 0 ? [`no tool is named ${list(unknown)}`] : []),
  ];
  const them = found.refused.length > 1 ? 'them' : 'it';
  return `Not loaded: ${parts.join('; ')}. Searching again won't load ${them}: do the work with the tools you have, or say why it can't be done.`;
}

const list = (names: readonly string[]) => names.join(', ');
