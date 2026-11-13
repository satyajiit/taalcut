// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: style profile exemplars (LRN1-STY) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.4 · "Most like the rest": the set's 1–3 most typical templates as hairline rows, each its
 *   contact sheet's first frame cropped at the sheet's own shape (viewer grey when it has none), its name as written
 *   (user text, never translated), length and shots in tabular figures; the whole row opens the template when the
 *   host can (one target, so a long name keeps its room; its name is what it shows, the template's)
 * states: default · no sheet (the viewer-grey frame) · no exemplars yet (hidden: the index hasn't the vectors) ·
 *   opens: hover, pressed, focus ring (base.css), no disabled or loading (opening is navigation)
 */
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { StyleExemplar, TemplateId, TemplateSummarySheet } from '@taalcut/core';
import { useId } from 'react';
import { UserContent } from '../cards/card-frame';
import { cn } from '../lib/cn';
import { useFormatters } from '../lib/format';
import { sheetTileStyle } from '../templates/sheet-tile';
import { toSeconds } from '../templates/slot-words';

/** The first frame's height in the row; its width follows the sheet's tile. */
const FRAME_HEIGHT = 64;

export interface StyleProfileExemplarsProps {
  readonly exemplars: readonly StyleExemplar[];
  /** A contact sheet's URL (the host's media URLs); null: nothing to show. */
  readonly sheetUrl: (sheet: TemplateSummarySheet) => string | null;
  /** Opens a template; without it the rows have no Open. */
  readonly onOpen?: (templateId: TemplateId) => void;
  /** The title's level: one under the section's. */
  readonly level?: 3 | 4;
}

function FirstFrame({
  exemplar,
  sheetUrl,
}: Pick<StyleProfileExemplarsProps, 'sheetUrl'> & { exemplar: StyleExemplar }) {
  const sheet = exemplar.contactSheet;
  const width = sheet ? Math.round((FRAME_HEIGHT * sheet.tile.width) / sheet.tile.height) : 36;
  return (
    <span
      aria-hidden
      className="block shrink-0 rounded-sm bg-viewer bg-no-repeat"
      style={
        sheet ? sheetTileStyle(sheet, sheetUrl(sheet), width, FRAME_HEIGHT) : { width, height: FRAME_HEIGHT }
      }
    />
  );
}

/** A row's hairline tile; a button too when the host can open the template. */
const TILE = 'flex w-full min-w-0 items-center gap-3 rounded-md border border-rule p-2 text-start';
const OPENS =
  'cursor-pointer transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover active:bg-pressed';

function ExemplarRow({
  exemplar,
  sheetUrl,
  onOpen,
}: Pick<StyleProfileExemplarsProps, 'sheetUrl' | 'onOpen'> & { exemplar: StyleExemplar }) {
  const { t } = useLingui();
  const formatters = useFormatters();
  const length = formatters.duration(toSeconds(exemplar.duration) * 1000);
  const shots = exemplar.slotCount;
  const name = exemplar.name;
  const content = (
    <>
      <FirstFrame exemplar={exemplar} sheetUrl={sheetUrl} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <UserContent
          translate="no"
          dir="auto"
          className="line-clamp-2 text-sm font-medium break-words text-ink"
        >
          {name}
        </UserContent>
        <span className="text-xs text-ink-3 tabular-nums">
          {t`${length} · ${plural(shots, { one: '# shot', other: '# shots' })}`}
        </span>
      </span>
    </>
  );
  return (
    <li data-slot="style-profile-exemplar" className="flex min-w-0">
      {onOpen ? (
        <button type="button" className={cn(TILE, OPENS)} onClick={() => onOpen(exemplar.templateId)}>
          {content}
        </button>
      ) : (
        <div className={TILE}>{content}</div>
      )}
    </li>
  );
}

export function StyleProfileExemplars({
  exemplars,
  sheetUrl,
  onOpen,
  level = 3,
}: StyleProfileExemplarsProps) {
  const titleId = useId();
  const Heading = level === 3 ? 'h3' : 'h4';
  if (exemplars.length === 0) return null;
  return (
    <section data-slot="style-profile-exemplars" aria-labelledby={titleId} className="flex flex-col gap-2">
      <Heading id={titleId} className="m-0 text-sm font-medium text-ink">
        <Trans>Most like the rest</Trans>
      </Heading>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 lg:grid-cols-3">
        {exemplars.map((exemplar) => (
          <ExemplarRow
            key={exemplar.templateId}
            exemplar={exemplar}
            sheetUrl={sheetUrl}
            {...(onOpen ? { onOpen } : {})}
          />
        ))}
      </ul>
    </section>
  );
}
