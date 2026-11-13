// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `sfx.searchSounds` (EAR1-B2): a described sound effect, searched over the SFX bank (its shipped CLAP embeddings),
 * the bundled `sfx-pack` and the user's own short sounds in the library (embedded once in the jobs process and kept
 * in the derived cache). Sounds are ranked by the audio's calibrated match and their names (listen/search); the
 * verdict is the audio's. A bank sound's `soundId` is what `sfx.addHits` takes in `soundIds`; a library sound is
 * placed by its `assetId`. EAR1-K2: the result shows in the chat as a `soundResults` card (sfx-search-card.ts).
 */
import { z } from 'zod';
import {
  artifactRefSchema,
  BUNDLED_LICENCES,
  defineTool,
  ok,
  SFX_CATEGORIES,
  type AnyTool,
  type AssetId,
  type AsyncResult,
  type SfxCategory,
} from '@taalcut/core';
import { fileContentHash } from '../listen/analysis/cache';
import type { EmbeddableSound } from '../listen/search/embedding-cache';
import type { SearchSoundsHit } from '../listen/search/queries';
import type { SoundSearcher } from '../listen/search/sound-search';
import { sfxBankSource, type SfxBankSource } from '../sfx/bank-source';
import type { SfxPack } from '../sfx/pack-catalogue';
import { listenWithin } from './listen-detach';
import { LISTEN_TOOL, spillOver } from './listen-search-tools';
import { searchSoundsCard } from './sfx-search-card';

/** A short sound of the user's in the library (the desktop decides which assets count). */
export interface LibrarySound {
  readonly assetId: AssetId;
  readonly title: string;
  readonly path: string;
  readonly contentHash: string;
}

export interface SfxSearchToolDeps {
  readonly searcher: SoundSearcher;
  /** The installed `sfx-bank` folder, or null. */
  readonly bankDir: () => string | null | undefined;
  /** The bundled `sfx-pack`; absent or failing: searched without it. */
  readonly pack?: () => AsyncResult<SfxPack>;
  /** The user's short sounds; absent or failing: searched without them. */
  readonly library?: (signal: AbortSignal) => AsyncResult<readonly LibrarySound[]>;
}

const SOURCES = ['bank', 'pack', 'library'] as const;

export const searchSoundsInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('The sound in plain words: "a soft rounded pop", "a deep boom"'),
  family: z.enum(SFX_CATEGORIES).optional().describe('Only this family (whoosh, riser, impact, hit)'),
  sources: z.array(z.enum(SOURCES)).min(1).max(3).optional().describe('Where to look (default all three)'),
  top: z.int().min(1).max(20).optional().describe('Sounds to return, best first (default 8)'),
});

const soundSchema = z.object({
  source: z.enum(SOURCES),
  soundId: z.string().optional().describe('A bank sound: pass it to sfx.addHits in soundIds'),
  packItemId: z.string().optional(),
  assetId: z.string().optional().describe("A library sound: the user's own asset"),
  title: z.string(),
  family: z.enum(SFX_CATEGORIES).nullable(),
  licence: z.enum(BUNDLED_LICENCES).optional(),
  z: z.number().describe('Calibrated audio match; 2 is weak, 2.5 plausible, 3 strong'),
  verdict: z.enum(['strong', 'plausible', 'weak', 'no_match']).nullable(),
  borderline: z.boolean(),
  nameScore: z.number().nullable().describe('How well its name fits the query, against the others'),
});

const searchSoundsFull = z.object({
  query: z.string(),
  hint: z.boolean().describe('A genre, mood, instrument or voice query: no verdicts'),
  sounds: z.array(soundSchema).max(20),
  /** Sources that could not be searched now. */
  skipped: z.array(z.enum(SOURCES)),
});

export const searchSoundsOutputSchema = z.union([
  searchSoundsFull,
  z.object({ artifact: artifactRefSchema, summary: z.string() }),
]);

type Sound = z.output<typeof soundSchema>;
type Described = Omit<Sound, 'z' | 'verdict' | 'borderline' | 'nameScore'>;

export function searchSoundsLine(output: z.output<typeof searchSoundsFull>): string {
  const best = output.sounds[0];
  if (!best) return `No sound found for "${output.query}".`;
  return `${output.sounds.length} sounds for "${output.query}"; best ${best.title} (z ${best.z}, ${best.verdict ?? 'hint'}).`;
}

async function gather(
  deps: SfxSearchToolDeps & { readonly bank: SfxBankSource },
  wanted: ReadonlySet<string>,
  family: SfxCategory | undefined,
  signal: AbortSignal,
) {
  const described = new Map<string, Described>();
  const sounds: EmbeddableSound[] = [];
  const skipped: Array<(typeof SOURCES)[number]> = [];
  let bankDir: string | undefined;
  if (wanted.has('bank')) {
    const bank = await deps.bank.load();
    const dir = deps.bankDir();
    if (bank.ok && dir) {
      bankDir = dir;
      for (const item of bank.value.items)
        described.set(item.id, {
          source: 'bank',
          soundId: item.id,
          title: item.title,
          family: item.family,
          licence: item.licence,
        });
    } else skipped.push('bank');
  }
  if (wanted.has('pack')) {
    const pack = deps.pack ? await deps.pack() : undefined;
    if (pack?.ok) {
      for (const item of pack.value.items) {
        if (family && item.category !== family) continue;
        const path = pack.value.pathOf(item);
        const content = await fileContentHash(path, signal);
        if (!content.ok) continue;
        const id = `pack:${item.id}`;
        sounds.push({ id, path, content: content.value, name: item.title });
        described.set(id, {
          source: 'pack',
          packItemId: item.id,
          title: item.title,
          family: item.category,
          licence: item.licence,
        });
      }
    } else skipped.push('pack');
  }
  if (wanted.has('library') && !family) {
    const library = deps.library ? await deps.library(signal) : undefined;
    if (library?.ok) {
      for (const sound of library.value) {
        const id = `asset:${sound.assetId}`;
        sounds.push({ id, path: sound.path, content: sound.contentHash, name: sound.title });
        described.set(id, { source: 'library', assetId: sound.assetId, title: sound.title, family: null });
      }
    } else skipped.push('library');
  }
  return { described, sounds, skipped, bankDir };
}

function toSound(hit: SearchSoundsHit, described: Described): Sound {
  return {
    ...described,
    z: hit.z,
    verdict: hit.verdict,
    borderline: hit.borderline,
    nameScore: hit.nameScore,
  };
}

export function searchSoundsTool(toolDeps: SfxSearchToolDeps): AnyTool {
  const deps = { ...toolDeps, bank: sfxBankSource(toolDeps.bankDir) };
  return defineTool({
    name: 'sfx.searchSounds',
    version: '1.0.0',
    summary: 'Finds sound effects matching a description in the SFX bank, the sound pack and the library.',
    description:
      'Finds sound effects that match a description ("a soft rounded pop", "a deep cinematic boom") in the SFX ' +
      "bank, the bundled sound pack and the user's own short sounds, best first, by a calibrated CLAP match of the " +
      'audio and its name. A bank sound has a soundId for sfx.addHits (soundIds); a library sound has its assetId. ' +
      'Genre and mood queries are hints with no verdict. Output over 8 KiB is stored as an artifact.',
    tags: ['sfx', 'search', 'listen', 'clap', 'sound-effect', 'bank'],
    input: searchSoundsInputSchema,
    output: searchSoundsOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: LISTEN_TOOL.timeoutMs,
    retry: LISTEN_TOOL.retry,
    // EAR1-R2: no tool-layer cache. Its key (tool, version, input) can't see a bank installed since, the library's
    // sounds or the model build, so a search before `sfx-bank` installs would answer `skipped: ['bank']` for an
    // hour; the embeddings are cached below it (the derived cache, the bank's shipped rows, the title store).
    cache: false,
    permission: { network: 'none', filesystem: { read: ['app-data', 'library'] } },
    summarize: (output) => ('summary' in output ? output.summary : searchSoundsLine(output)),
    describeCall: (_input, output) => ('sounds' in output ? String(output.sounds.length) : undefined),
    resultCard: async (output, ctx) => {
      if (!('sounds' in output)) return ok(undefined);
      const bank = output.sounds.some((sound) => sound.source === 'bank')
        ? await deps.bank.load()
        : undefined;
      const creditOf = (id: string) => (bank?.ok ? (bank.value.item(id)?.credit ?? undefined) : undefined);
      return ok(searchSoundsCard(output, ctx, creditOf));
    },
    run: async (input, ctx) => {
      const wanted = new Set<string>(input.sources ?? SOURCES);
      const found = await gather(deps, wanted, input.family, ctx.signal);
      const top = input.top ?? 8;
      // EAR1-R2: the first search may download the CLAP text model; past 100 s it goes on in the background.
      const searched = await listenWithin(ctx.signal, (signal) =>
        deps.searcher.search({
          query: input.query,
          top,
          ...(found.bankDir ? { bankDir: found.bankDir } : {}),
          ...(input.family ? { bankFamily: input.family } : {}),
          sounds: found.sounds,
          signal,
        }),
      );
      if (!searched.ok) return searched;
      const sounds = searched.value.hits
        .map((hit) => {
          const described = found.described.get(hit.id);
          return described ? toSound(hit, described) : undefined;
        })
        .filter((s): s is Sound => s !== undefined)
        .slice(0, top);
      const output = { query: input.query, hint: searched.value.hint, sounds, skipped: found.skipped };
      return spillOver(output, searchSoundsLine(output), ctx.artifacts);
    },
  });
}
