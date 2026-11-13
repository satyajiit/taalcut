// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · mode: Operate · system: DESIGN.md · real creation shelf; empty preview, review, working and ready; shared hover/press motion. */

import { useLingui } from '@lingui/react/macro';
import { RationalTime, type CreationProject } from '@taalcut/core';
import { CONCEPT_ICONS, PageSection, PRESS_ROW, UserContent, VERB_ICONS, cn } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { CreationPreview } from './create-preview';
import { CREATION_STATUS } from './create-words';

export function EmptyCreationShelf() {
  const { t } = useLingui();
  return (
    <PageSection title={t`Your video shelf`} icon={CONCEPT_ICONS.project}>
      <div aria-hidden className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-center gap-6">
        <div className="flex aspect-video items-end rounded-xl border border-rule-subtle bg-well p-5">
          <div className="h-2 w-2/5 rounded bg-rule-subtle" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="aspect-[9/16] max-h-40 rounded-lg border border-rule-subtle bg-well" />
          <div className="aspect-square rounded-lg border border-rule-subtle bg-well" />
        </div>
      </div>
      <p className="m-0 max-w-prose type-body text-ink-2">{t`Start a video above. Your brief, scenes and finished edit will be here when you come back.`}</p>
    </PageSection>
  );
}

export function CreationShelf({ projects }: { projects: CreationProject[] }) {
  const { t } = useLingui();
  const featured = projects[0];
  if (!featured) return null;
  return (
    <PageSection title={t`Pick up where you left off`} icon={CONCEPT_ICONS.project}>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ShelfVideo project={featured} featured />
        {projects.length > 1 ? (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-1">
            {projects.slice(1).map((project) => (
              <ShelfVideo key={project.projectId} project={project} />
            ))}
          </div>
        ) : null}
      </div>
    </PageSection>
  );
}

function ShelfVideo({ project, featured = false }: { project: CreationProject; featured?: boolean }) {
  const { t, i18n } = useLingui();
  const Next = VERB_ICONS.next;
  const seconds = i18n.number(RationalTime.toSeconds(project.brief.duration), {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
  });
  const preview = project.draft?.visualPreviewAssetId;
  return (
    <Link
      data-slot="creation-shelf-item"
      data-featured={featured || undefined}
      to="/create/$projectId"
      params={{ projectId: project.projectId }}
      search={{ step: project.timelineId ? 'production' : project.draft ? 'script' : 'brief' }}
      className={cn(
        'group grid min-w-0 gap-4 rounded-xl text-start',
        featured
          ? 'grid-cols-2 items-center gap-5 xl:grid-cols-1 xl:items-stretch xl:gap-4'
          : 'sm:grid-cols-[8rem_minmax(0,1fr)] xl:grid-cols-[9rem_minmax(0,1fr)]',
        PRESS_ROW,
      )}
    >
      <div
        data-slot="creation-shelf-preview"
        className={cn(
          'flex aspect-video min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-xl bg-well p-3 group-hover:bg-hover',
          featured && 'xl:p-4',
        )}
      >
        {preview ? (
          <CreationPreview assetId={preview} compact />
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <UserContent
              className={cn(
                'block line-clamp-3 break-words text-ink',
                featured ? 'type-page-title' : 'type-card-title',
              )}
            >
              {project.brief.title}
            </UserContent>
            <span className="type-meta text-ink-2">{t`Video brief · preview not created yet`}</span>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2">
        <UserContent data-slot="creation-shelf-title" className="block break-words type-card-title text-ink">
          {project.brief.title}
        </UserContent>
        <div className="flex flex-wrap gap-x-3 gap-y-1 type-meta text-ink-2">
          <span>{i18n._(CREATION_STATUS[project.status])}</span>
          <span>{seconds}</span>
          <time dateTime={new Date(project.updatedAt).toISOString()}>
            {i18n.date(project.updatedAt, { dateStyle: 'medium' })}
          </time>
        </div>
        <span
          data-slot="creation-shelf-action"
          className="mt-1 inline-flex items-center gap-2 type-label text-ink group-hover:underline group-hover:underline-offset-4"
        >
          {project.timelineId ? t`Open video` : t`Continue video`}
          <Next aria-hidden className="size-4" />
        </span>
      </div>
    </Link>
  );
}
