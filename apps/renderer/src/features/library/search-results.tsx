// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: search results · system: DESIGN.md v0.6 + UX4 (type roles, the icon registry)
 * the shots that match, best first: the shot's frame, the passage that matched with the words marked on the
 *   selection wash, and why it matched in words (Described, Said, On screen, Looks like it)
 * states: loading (still bone tiles) · results (arrive once: 8 px rise) · empty ("No clips match. Try fewer words.")
 *   · error (the cause and Try again) · keyword-only (one line: the search model is still on its way)
 *   · importing (IX-R4: one line, how many clips search can't find yet; searchable clips show like any other)
 *   · hit: default · hover (hover surface) · focus (base ring) · active (pressed); Find similar is a ghost Button with its glyph
 *   · a frame that won't load (the viewer grey keeps its place with a still "no picture" mark)
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { SearchHit, SearchResult, TaalcutError } from '@taalcut/core';
import { Arrival, Button, Chip, ErrorLine, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { ImageOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useMediaUrls } from '../../services/provider';

const MATCH_WORDS: Readonly<Record<SearchHit['matchedBy'][number], MessageDescriptor>> = {
  visual: msg`Looks like it`,
  description: msg`Described`,
  speech: msg`Said`,
  onScreenText: msg`On screen`,
  keyword: msg`Name`,
};

/** The matched passage with its highlights marked (offsets are UTF-16, as the contract says). */
function Snippet({ snippet }: { snippet: NonNullable<SearchHit['snippet']> }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of snippet.highlights) {
    if (start < at) continue;
    parts.push(snippet.text.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-selected px-px text-ink">
        {snippet.text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(snippet.text.slice(at));
  return (
    <UserContent translate="no" className="text-sm text-ink-2">
      {parts}
    </UserContent>
  );
}

/** The shot's frame on the viewer grey; a frame that won't load leaves the grey with a still mark. */
function HitFrame({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="relative block aspect-[9/16] overflow-hidden rounded-md bg-viewer">
      {src && !broken ? (
        <img
          src={src}
          alt=""
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-contain"
        />
      ) : broken ? (
        <ImageOff aria-hidden className="absolute inset-0 m-auto size-5 text-viewer-rule" />
      ) : null}
    </span>
  );
}

function Hit({ hit, onSimilar }: { hit: SearchHit; onSimilar: (shotId: SearchHit['shot']['id']) => void }) {
  const { t, i18n } = useLingui();
  const media = useMediaUrls();
  const src = hit.shot.thumbnail ? media.derived(hit.shot.thumbnail) : null;
  return (
    <li className="flex min-w-0 flex-col gap-2" data-slot="search-hit">
      <Link
        to="/library/$assetId"
        params={{ assetId: hit.asset.id }}
        className="flex flex-col gap-2 rounded-lg p-1 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover active:bg-pressed"
      >
        <HitFrame src={src} />
        <span className="sr-only" translate="no" data-user-content>
          {hit.asset.name}
        </span>
        {hit.snippet ? <Snippet snippet={hit.snippet} /> : null}
      </Link>
      <div className="flex flex-wrap items-center gap-1 px-1">
        {hit.matchedBy.map((kind) => (
          <Chip key={kind}>{i18n._(MATCH_WORDS[kind])}</Chip>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon={VERB_ICONS.findSimilar}
        className="self-start"
        onClick={() => onSimilar(hit.shot.id)}
      >
        {t`Find similar`}
      </Button>
    </li>
  );
}

export interface SearchResultsProps {
  query: string | null;
  result: SearchResult | undefined;
  error: TaalcutError | undefined;
  loading: boolean;
  onRetry: () => void;
  onSimilar: (shotId: SearchHit['shot']['id']) => void;
  onClear: () => void;
  /** Clips an import is still bringing in that search can't find yet (0: say nothing). */
  notSearchable?: number;
}

export function SearchResults({
  query,
  result,
  error,
  loading,
  onRetry,
  onSimilar,
  onClear,
  notSearchable = 0,
}: SearchResultsProps) {
  const { t } = useLingui();
  if (error && !result)
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorLine error={error} />
        <Button size="sm" icon={VERB_ICONS.retry} onClick={onRetry}>
          {t`Try again`}
        </Button>
      </div>
    );
  if (!result || loading)
    return (
      <ul
        aria-busy="true"
        aria-label={t`Searching`}
        className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 p-0"
      >
        {Array.from({ length: 12 }, (_, i) => (
          <li key={i} aria-hidden className="flex flex-col gap-2 p-1">
            <span className="tc-bone block aspect-[9/16] rounded-md bg-hover" />
            <span className="tc-bone block h-3 w-4/5 rounded-sm bg-hover" />
          </li>
        ))}
      </ul>
    );
  const count = result.hits.length;
  return (
    <Arrival animate className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 role="status" className="m-0 type-section text-ink">
          {query ? (
            <Plural value={count} _0="No clips match" one="# shot matches" other="# shots match" />
          ) : (
            <Plural
              value={count}
              _0="No shots look like this one"
              one="# shot looks like this one"
              other="# shots look like this one"
            />
          )}
        </h2>
        {count === 0 && query ? <p className="m-0 type-body text-ink-2">{t`Try fewer words.`}</p> : null}
        <Button variant="ghost" size="sm" className="ms-auto" onClick={onClear}>
          {query ? t`Clear search` : t`Back to all clips`}
        </Button>
      </div>
      <ResultNotes keywordOnly={result.degraded === 'keyword-only'} notSearchable={notSearchable} />
      {count > 0 ? (
        <ul
          aria-label={t`Results`}
          className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 p-0"
        >
          {result.hits.map((hit) => (
            <Hit key={hit.shot.id} hit={hit} onSimilar={onSimilar} />
          ))}
        </ul>
      ) : null}
    </Arrival>
  );
}

/** What the results can't include yet: matches by picture (model downloading), clips an import hasn't reached. */
function ResultNotes({ keywordOnly, notSearchable }: { keywordOnly: boolean; notSearchable: number }) {
  return (
    <>
      {keywordOnly ? (
        <p className="m-0 max-w-prose type-body text-ink-2">
          <Trans>
            Matching words only for now. Searching by what clips look like starts when its model has
            downloaded.
          </Trans>
        </p>
      ) : null}
      {notSearchable > 0 ? (
        <p className="m-0 max-w-prose type-body text-ink-2" data-slot="not-searchable">
          <Plural
            value={notSearchable}
            one="# clip isn’t searchable yet. It shows up here once Taalcut has looked at it."
            other="# clips aren’t searchable yet. They show up here once Taalcut has looked at them."
          />
        </p>
      ) : null}
    </>
  );
}
