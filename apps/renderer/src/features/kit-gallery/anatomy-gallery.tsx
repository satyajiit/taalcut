// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page part: the kit's page anatomy (UX4) · system: DESIGN.md v0.6 + UX4
 * ViewLinks (an area's views as links on the gliding thumb), PageSection, ListRow (pill and framed, selection,
 *   dense, static) and EmptyState (a page with Kaatu, and a compact no-results row), with sample words as written */
import { Plural, useLingui } from '@lingui/react/macro';
import {
  Button,
  CONCEPT_ICONS,
  EmptyState,
  ListRow,
  ListRows,
  PageSection,
  VERB_ICONS,
  ViewLink,
  ViewLinks,
} from '@taalcut/ui';
import { useState, type MouseEvent } from 'react';
import { KitPart, KitSection } from './kit-parts';

/* Sample project names: data as written, never translated. */
const SAMPLE_GOLDEN = 'Golden hour market';
const SAMPLE_GOA = 'Trip to Goa reel';
const SAMPLE_MONSOON = 'Monsoon in 60 seconds';
const SAMPLE_PROJECTS = [SAMPLE_GOLDEN, SAMPLE_GOA, SAMPLE_MONSOON] as const;

type View = 'projects' | 'exports' | 'archived';

/** Views that switch in place here (the real ones are router links to pages). */
function ViewsDemo() {
  const { t } = useLingui();
  const [view, setView] = useState<View>('projects');
  const go = (next: View) => (event: MouseEvent) => {
    event.preventDefault();
    setView(next);
  };
  return (
    <ViewLinks label={t`Example views`} memory="kit-example">
      <ViewLink asChild current={view === 'projects'} icon={CONCEPT_ICONS.project}>
        <a href="#kit-projects" onClick={go('projects')}>
          {t`Projects`}
        </a>
      </ViewLink>
      <ViewLink asChild current={view === 'exports'} icon={CONCEPT_ICONS.export} count={2}>
        <a href="#kit-exports" onClick={go('exports')}>
          {t`Exports`}
        </a>
      </ViewLink>
      <ViewLink asChild current={view === 'archived'} icon={CONCEPT_ICONS.archived}>
        <a href="#kit-archived" onClick={go('archived')}>
          {t`Archived`}
        </a>
      </ViewLink>
    </ViewLinks>
  );
}

export function ViewLinksGallery() {
  const { t } = useLingui();
  return (
    <KitSection
      title={t`View links`}
      icon={CONCEPT_ICONS.make}
      description={t`An area’s views as links. The thumb glides to the current one, and across pages too.`}
    >
      <ViewsDemo />
    </KitSection>
  );
}

export function PageSectionGallery() {
  const { t } = useLingui();
  return (
    <KitSection
      title={t`Page sections`}
      icon={CONCEPT_ICONS.template}
      description={t`An icon-led heading, one line and the section’s own actions. More space above a section than inside it.`}
    >
      <div className="rounded-lg border border-dashed border-rule p-5">
        <PageSection
          title={t`Your templates`}
          icon={CONCEPT_ICONS.template}
          description={t`Templates you made from reels you like.`}
          actions={
            <Button size="sm" icon={VERB_ICONS.import}>
              {t`Import`}
            </Button>
          }
        >
          <p className="m-0 type-body text-ink-2">{t`The section’s content starts 16 px under its heading.`}</p>
        </PageSection>
        <PageSection
          title={t`Starters`}
          icon={CONCEPT_ICONS.reel}
          description={t`Ready-made shapes to begin from.`}
        >
          <PageSection level={3} title={t`Built-in formats`} icon={CONCEPT_ICONS.slot}>
            <p className="m-0 type-body text-ink-2">{t`A part inside a section is an h3.`}</p>
          </PageSection>
        </PageSection>
      </div>
    </KitSection>
  );
}

function RowsDemo() {
  const { t } = useLingui();
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set([1]));
  const toggle = (index: number) => (on: boolean) =>
    setPicked((was) => {
      const next = new Set(was);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  return (
    <ListRows aria-label={t`Example projects`}>
      {SAMPLE_PROJECTS.map((name, index) => (
        <ListRow
          key={name}
          title={<span translate="no">{name}</span>}
          meta={<Plural value={index + 1} one="# video" other="# videos" />}
          trailingMeta={t`Oct 12`}
          leading={CONCEPT_ICONS.project}
          selected={picked.has(index)}
          select={{ checked: picked.has(index), onCheckedChange: toggle(index) }}
          action={<a href={`#kit-row-${index}`} onClick={(event) => event.preventDefault()} />}
          actions={
            <Button size="icon" variant="ghost" aria-label={t`Project actions`} icon={VERB_ICONS.more} />
          }
        />
      ))}
      <ListRow
        title={t`A row that can’t be opened now`}
        meta={t`Disabled`}
        leading={CONCEPT_ICONS.clip}
        select={{ checked: false, onCheckedChange: () => undefined }}
        disabled
      />
    </ListRows>
  );
}

export function ListRowGallery() {
  const { t } = useLingui();
  return (
    <KitSection
      title={t`List rows`}
      icon={CONCEPT_ICONS.clip}
      description={t`One recipe: a hover pill on the canvas, or divided rows in a frame. The whole row is its one action.`}
    >
      <RowsDemo />
      <KitPart title={t`In a frame, dense`}>
        <ListRows framed aria-label={t`Example settings`}>
          <ListRow
            size="dense"
            title={t`Local only`}
            meta={t`Nothing leaves this computer.`}
            leading={CONCEPT_ICONS.privacy}
          />
          <ListRow
            size="dense"
            title={t`Memory`}
            meta={t`What Taalcut remembers about you.`}
            leading={CONCEPT_ICONS.memory}
          />
          <ListRow
            size="dense"
            static
            title={t`Usage`}
            trailingMeta={t`This month`}
            leading={CONCEPT_ICONS.usage}
          />
        </ListRows>
      </KitPart>
    </KitSection>
  );
}

export function EmptyStateGallery() {
  const { t } = useLingui();
  return (
    <KitSection
      title={t`Empty states`}
      icon={CONCEPT_ICONS.folder}
      description={t`The shape of what will be here, one line, the one action, and Kaatu for company.`}
    >
      <EmptyState
        titleAs="h3"
        title={t`No projects yet`}
        description={t`Paste a reel you like or pick a starter, and your first project shows up here.`}
        action={
          <Button variant="primary" icon={VERB_ICONS.makeVideo}>
            {t`Make a video`}
          </Button>
        }
      />
      <KitPart title={t`No results`}>
        <EmptyState
          variant="compact"
          icon={CONCEPT_ICONS.search}
          title={t`No clips match these filters.`}
          description={t`Try fewer, or clear them.`}
          action={
            <Button size="sm" variant="ghost" icon={VERB_ICONS.clearFilters}>
              {t`Clear filters`}
            </Button>
          }
        />
      </KitPart>
    </KitSection>
  );
}
