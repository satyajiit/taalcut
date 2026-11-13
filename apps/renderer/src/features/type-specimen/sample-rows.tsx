// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/*
 * The specimen's samples of the app's chrome: the window bar's title, a section heading, settings rows and a
 * template row. Each is drawn with the type roles (design/tokens/roles.css), so the page shows the
 * roles as they are; the controls are the kit's own. The words are data (samples.ts), shown as written.
 */
import { AvartanMark, Button, Switch } from '@taalcut/ui';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleDashed,
  Folder,
  Shapes,
  Star,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import type { Samples, SettingSample } from './samples';

/** The window bar: back and forward, the mark, the page's name and what is open in it, one action. */
export function BarSample({ s }: { s: Samples }) {
  return (
    <div className="flex min-h-13 items-center gap-3 rounded-lg border border-rule-subtle bg-canvas px-4 py-2">
      <span className="flex shrink-0 items-center gap-2 text-ink-3">
        <ChevronLeft aria-hidden className="size-4" />
        <ChevronRight aria-hidden className="size-4" />
      </span>
      <AvartanMark className="size-5" />
      <p className="type-page-title flex min-w-0 flex-wrap items-center gap-x-1 text-ink">
        <span className="font-medium text-ink-2">{s.area}</span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
        <span className="min-w-0">{s.detail}</span>
      </p>
      <Button size="sm" className="ms-auto shrink-0">
        <Upload aria-hidden />
        {s.importLabel}
      </Button>
    </div>
  );
}

/** A section of a page: its icon, its heading and count, and one line on what it holds. */
export function SectionSample({ s }: { s: Samples }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="type-section flex items-center gap-2 text-ink">
          <Shapes aria-hidden className="size-[1.05em] shrink-0 text-ink-2" />
          {s.section}
        </p>
        <span className="type-caption rounded-pill bg-sunken px-2 py-0.5 text-ink-2">{s.sectionCount}</span>
      </div>
      <p className="type-body max-w-prose text-ink-2">{s.sectionNote}</p>
    </div>
  );
}

function SettingRow({ row }: { row: SettingSample }) {
  const [on, setOn] = useState(true);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
        <p className="type-label text-ink">{row.label}</p>
        <p className="type-meta max-w-prose text-ink-2">{row.hint}</p>
      </div>
      {row.value === undefined ? (
        <Switch checked={on} onCheckedChange={setOn} aria-label={row.label} />
      ) : (
        <span className="type-body flex shrink-0 items-center gap-1.5 rounded-md border border-rule bg-canvas px-3 py-1 text-ink">
          {row.value}
          <ChevronsUpDown aria-hidden className="size-3.5 text-ink-3" />
        </span>
      )}
    </div>
  );
}

/** Settings rows with their hints: the densest text in the app. */
export function SettingsSample({ s, rows = s.settings.length }: { s: Samples; rows?: number }) {
  return (
    <div className="flex flex-col divide-y divide-rule-subtle rounded-lg border border-rule-subtle bg-raised">
      {s.settings.slice(0, rows).map((row) => (
        <SettingRow key={row.label} row={row} />
      ))}
    </div>
  );
}

const STRIP = [1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1];

/** A row in Templates: its reel, its name, its facts, its check and tags, and when it changed. */
export function TemplateRowSample({ s }: { s: Samples }) {
  const row = s.template;
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg px-2 py-2 hover:bg-hover">
      <span aria-hidden className="block h-16 w-12 shrink-0 rounded-md bg-viewer" />
      <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-1">
        <p className="type-card-title flex items-center gap-2 text-ink">
          {row.title}
          <Star aria-hidden className="size-3.5 shrink-0 fill-current text-ink-2" />
        </p>
        <p className="type-meta text-ink-2">
          {row.meta} · {row.more}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span aria-hidden className="flex h-1.5 w-24 gap-px">
            {STRIP.map((grow, index) => (
              <span key={index} className="block h-full rounded-clip bg-beat/70" style={{ flexGrow: grow }} />
            ))}
          </span>
          <span className="type-meta flex items-center gap-1 font-medium text-ink">
            <CircleDashed aria-hidden className="size-3.5 text-warning-strong" />
            {row.toCheck}
          </span>
          {row.tags.map((tag) => (
            <span key={tag} className="type-caption rounded-pill bg-sunken px-2 py-0.5 text-ink-2">
              {tag}
            </span>
          ))}
          <span className="type-meta flex items-center gap-1 text-ink-2">
            <Folder aria-hidden className="size-3.5 text-ink-3" />
            {row.folder}
          </span>
        </div>
      </div>
      <div className="type-meta flex shrink-0 flex-col items-end gap-1 text-ink-2">
        <span>{row.trend}</span>
        <span>{row.changed}</span>
      </div>
    </div>
  );
}
