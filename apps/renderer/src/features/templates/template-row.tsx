// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: template row (Your templates; UX1, UX3, UX4 tpl) · system: DESIGN.md v0.6 + UX4
 *   (ListRow as a windowed listbox's option)
 * one option of the library's list, on the kit's ListRow (as="div", role="option": the list is a windowed listbox):
 *   the reel's first frame on the viewer grey leads, with a selection box on its corner (shown on hover, on focus
 *   and while any row is selected; an ink fill when picked, never a second marigold: UX1; aria-hidden, as the
 *   option's aria-selected says it, so nothing interactive nests). Its name as written (a starter fork in this
 *   language) and a favourite's star in ink; its format as a kind chip before the facts in one ink-2 line; its
 *   slots as rose blocks on the time axis with how many still need checking (a dashed warning ring and the words)
 *   or that every slot is approved, its tags as soft chips, its folder and where it came from; at the end, the trend
 *   date ("Trend may be stale" in the warning wash) and when it last changed. In a narrow list (under @xl) the
 *   facts keep slots, length and tempo, one tag shows, the folder is its mark alone and the strip narrows first:
 *   rows are a fixed height. While the list is a search's answer (LRN1-FIX) the strip's line says what matched
 * states: the kit row's default · hover (hover surface, box shows) · focus-visible (base ring, roving: one row in
 *   the tab order; box shows) · active (pressed surface and the row's give) · selected (selection wash, ink box with
 *   its tick, aria-selected) · disabled n/a · loading (the list's bones) · error n/a · success n/a (opening it is it)
 * contrast: facts ink-2 on canvas/hover/selected ≥ 7:1; chip text strong-on-soft ≥ 4.5:1
 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { TemplateSearchHit, TemplateSummary } from '@taalcut/core';
import {
  Chip,
  cn,
  FormatChip,
  ListRow,
  MatchedBy,
  PRESS_ROW,
  sheetTileStyle,
  toSeconds,
  UserContent,
} from '@taalcut/ui';
import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  FileDown,
  Folder as FolderIcon,
  Globe,
  Shapes,
  Star,
} from 'lucide-react';
import { memo, type CSSProperties, type MouseEvent } from 'react';
import { useMediaUrls } from '../../services/provider';
import { formatDay, formatLanguage, formatSeconds } from '../shared/format';
import { isStarterName, templateName } from './library/library-words';
import { STALE_AFTER_DAYS } from './library/template-search';
import { FORMAT_NAMES, PLATFORM_LABELS } from './template-words';

/** A row's height and the gap under it, px (the list places rows by it). */
export const ROW_HEIGHT = 80;
const POSTER = { width: 36, height: 64 } as const;
const MAX_CHIPS = 2;

export interface TemplateRowProps {
  readonly summary: TemplateSummary;
  readonly index: number;
  readonly total: number;
  readonly selected: boolean;
  /** Some row is selected: every box shows, so the next pick is one click. */
  readonly selecting: boolean;
  readonly tabbable: boolean;
  /** The folder's name when the view isn't that folder. */
  readonly folder: string | null;
  /** Its trend date is older than templates.staleAfterDays. */
  readonly stale: boolean;
  /** Its hit while the list is a search's answer: the row says what matched. */
  readonly match?: TemplateSearchHit | undefined;
  readonly now: number;
  readonly style: CSSProperties;
  /** A click: open it, or with ⌘ or Shift (or on the box), select it. */
  readonly onPick: (index: number, how: 'open' | 'toggle' | 'extend') => void;
}

function Poster({ summary }: { summary: TemplateSummary }) {
  const media = useMediaUrls();
  const sheet = summary.contactSheet;
  const url = sheet ? media.templateAsset(sheet) : null;
  return (
    <span
      aria-hidden
      className="block shrink-0 rounded-md bg-viewer bg-no-repeat"
      style={sheet ? sheetTileStyle(sheet, url, POSTER.width, POSTER.height) : POSTER}
    />
  );
}

/** Where it came from, as a small mark with its words (sr-only and a tooltip): the row has no room for a sentence. */
function Provenance({ provenance }: { provenance: TemplateSummary['provenance'] }) {
  const { t } = useLingui();
  if (!provenance) return null;
  const [Icon, words, tone] =
    provenance.kind === 'hub'
      ? provenance.removed
        ? [Globe, t`Removed from the hub`, 'text-warning-strong']
        : [Globe, t`From the hub`, 'text-ink-3']
      : provenance.kind === 'file'
        ? [FileDown, t`Imported from a file`, 'text-ink-3']
        : [Shapes, t`From a starter`, 'text-ink-3'];
  return (
    <span className={cn('flex shrink-0 items-center', tone)} title={words}>
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">{words}</span>
    </span>
  );
}

/**
 * After the slot strip, the library's facts: how many slots still need checking, its tags (one in a narrow list), its
 * folder (its mark alone when narrow) and where it came from.
 */
function LibraryFacts({ summary, folder }: { summary: TemplateSummary; folder: string | null }) {
  const { t, i18n } = useLingui();
  const hidden = i18n.number(summary.tags.length - MAX_CHIPS);
  const hiddenNarrow = i18n.number(summary.tags.length - 1);
  const toCheck = summary.slotCount - summary.approvedSlots;
  return (
    <>
      {toCheck > 0 ? (
        <span
          data-slot="row-to-check"
          className="flex shrink-0 items-center gap-1 font-medium text-ink"
          title={t`Open the template to check each slot and approve it.`}
        >
          <CircleDashed aria-hidden className="size-3.5 text-warning-strong" />
          <Plural value={toCheck} one="# slot not approved" other="# slots not approved" />
        </span>
      ) : (
        <span data-slot="row-approved" className="flex shrink-0 items-center gap-1 text-ink-2">
          <CircleCheck aria-hidden className="size-3.5 text-success-strong" />
          {t`Approved`}
        </span>
      )}
      {summary.tags.slice(0, MAX_CHIPS).map((tag, n) => (
        <Chip
          key={tag}
          tone="neutral"
          translate="no"
          className={cn('shrink-0', n > 0 && 'hidden @xl:inline-flex')}
        >
          {tag}
        </Chip>
      ))}
      {summary.tags.length > 1 ? <span className="shrink-0 @xl:hidden">{t`+${hiddenNarrow}`}</span> : null}
      {summary.tags.length > MAX_CHIPS ? (
        <span className="hidden shrink-0 @xl:inline">{t`+${hidden}`}</span>
      ) : null}
      {folder ? (
        // A narrow row has no room for the folder's name: its mark says it (tooltip, and sr-only text). The
        // name comes first in the DOM, so while it is screen-reader-only it sits inside the mark's box. A long
        // name is cut with an ellipsis, all of it in the tooltip: the person's words, of any length.
        <span
          translate="no"
          className="flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap @xl:shrink"
          title={folder}
        >
          <span className="sr-only @xl:not-sr-only @xl:order-1 @xl:truncate" title={folder}>
            <UserContent translate="no">{folder}</UserContent>
          </span>
          <FolderIcon aria-hidden className="size-3.5 shrink-0 text-ink-3" />
        </span>
      ) : null}
      <Provenance provenance={summary.provenance} />
    </>
  );
}

function TemplateRowView({
  summary,
  index,
  total,
  selected,
  selecting,
  tabbable,
  folder,
  stale,
  match,
  now,
  style,
  onPick,
}: TemplateRowProps) {
  const { t, i18n } = useLingui();
  const name = templateName(i18n, summary);
  const tempo = summary.bpm ? i18n.number(Math.round(summary.bpm)) : null;
  // Always: length and tempo. A wide list adds where it's for, its format and its language.
  const facts = [formatSeconds(i18n, toSeconds(summary.duration)), tempo ? t`${tempo} BPM` : null].filter(
    Boolean,
  );
  const more = [
    summary.platform ? i18n._(PLATFORM_LABELS[summary.platform]) : null,
    summary.language ? formatLanguage(i18n, summary.language) : null,
  ].filter(Boolean);
  const span = summary.slotStrip.reduce((sum, frames) => sum + frames, 0) || 1;
  const trend = summary.trendFreshness;
  const days = i18n.number(STALE_AFTER_DAYS);
  const pick = (event: MouseEvent, how: 'open' | 'toggle') => {
    event.preventDefault();
    event.stopPropagation();
    onPick(index, event.shiftKey ? 'extend' : event.metaKey || event.ctrlKey ? 'toggle' : how);
  };

  const leading = (
    <span className="relative shrink-0">
      <Poster summary={summary} />
      <span
        aria-hidden
        data-slot="row-check"
        onClick={(event) => pick(event, 'toggle')}
        className={cn(
          'absolute -start-2 -top-2 flex size-7 items-center justify-center',
          'transition-opacity duration-(--dur-micro) ease-(--ease-out) group-hover/row:opacity-100 group-focus-visible/row:opacity-100',
          selecting || selected ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span
          className={cn(
            'flex size-[1.125rem] items-center justify-center rounded-sm border border-rule-strong bg-raised text-transparent shadow-sm',
            'transition-colors duration-(--dur-micro) ease-(--ease-out) group-hover/row:border-ink-3',
            selected && 'border-inverse bg-inverse text-on-inverse group-hover/row:border-inverse',
          )}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      </span>
    </span>
  );
  const title = (
    <span className="flex min-w-0 items-center gap-x-2">
      {isStarterName(summary) ? (
        <span className="truncate">{name}</span>
      ) : (
        <UserContent translate="no" className="truncate">
          {name}
        </UserContent>
      )}
      {summary.favourite ? (
        <Star aria-label={t`Favourite`} className="size-3.5 shrink-0 fill-current text-ink-2" />
      ) : null}
    </span>
  );
  const meta = (
    <span className="flex min-w-0 items-center gap-2">
      {summary.formatId ? (
        <FormatChip
          formatId={summary.formatId}
          label={i18n._(FORMAT_NAMES[summary.formatId])}
          className="hidden @xl:inline-flex"
        />
      ) : null}
      <span className="truncate">
        <Plural value={summary.slotCount} one="# slot" other="# slots" /> · {facts.join(' · ')}
        {more.length > 0 ? <span className="hidden @xl:inline"> · {more.join(' · ')}</span> : null}
      </span>
    </span>
  );
  // The trend and changed dates come in at 44rem, not @2xl: on the page grid's column the list can be 42–44rem
  // wide at 1280, where they would leave a long language's facts line too little room (UX4 shell).
  const dates = (
    <span className="hidden w-44 flex-col items-end gap-1 type-meta text-ink-2 @[44rem]:flex">
      {trend ? (
        stale ? (
          <Chip
            tone="warning"
            title={t`Its trend date is over ${days} days old: the sound or style may have moved on.`}
          >
            <CircleAlert aria-hidden />
            {t`Trend may be stale`}
          </Chip>
        ) : (
          <span>
            {t`Trend`}{' '}
            <time dateTime={trend.date} className="font-sans">
              {formatDay(i18n, Date.parse(trend.date), now)}
            </time>
          </span>
        )
      ) : null}
      <span>
        {t`Changed`}{' '}
        <time dateTime={new Date(summary.updatedAt).toISOString()} className="font-sans">
          {formatDay(i18n, summary.updatedAt, now)}
        </time>
      </span>
    </span>
  );

  return (
    <ListRow
      as="div"
      role="option"
      aria-selected={selected}
      aria-posinset={index + 1}
      aria-setsize={total}
      tabIndex={tabbable ? 0 : -1}
      data-index={index}
      data-slot="template-row"
      onClick={(event) => pick(event, 'open')}
      style={{ ...style, height: ROW_HEIGHT - 4 }}
      className={cn('absolute inset-x-0 top-0 cursor-pointer active:bg-pressed', PRESS_ROW)}
      leading={leading}
      title={title}
      meta={meta}
      trailingMeta={dates}
    >
      <span className="flex min-w-0 items-center gap-x-2 type-meta text-ink-2">
        {/* The strip gives way first (down to 2 rem), so the words beside it fit in every language. */}
        <span aria-hidden data-slot="row-slot-strip" className="flex h-1.5 w-28 min-w-8 shrink gap-px">
          {summary.slotStrip.map((frames, slot) => (
            <span
              key={slot}
              className="block h-full rounded-clip bg-beat/70"
              style={{ flexGrow: frames / span, flexBasis: 0 }}
            />
          ))}
        </span>
        {match ? (
          <MatchedBy hit={match} className="truncate type-meta" tooltip />
        ) : (
          <LibraryFacts summary={summary} folder={folder} />
        )}
      </span>
    </ListRow>
  );
}

export const TemplateRow = memo(TemplateRowView);
