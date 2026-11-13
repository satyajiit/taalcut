// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · component: MakeStudioLead · mode: Operate · system: DESIGN.md v0.7
 * Studio workbench lead for Make (/projects): highlights the most recent active cut with its 9:16 frame,
 * proportional AI/You cut rhythm strip, rose beat cadence ticks, and studio-wide cut statistics.
 * states: default · hover · focus · active (secondary/ghost controls; preserves single primary in window bar)
 * contrast: raised plates over canvas with rule hairlines; ai/you/beat tokens paired with text labels
 * reduced-motion: instant transitions, no ambient loops
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { ProjectSummary, Timeline, TimelineSummary } from '@taalcut/core';
import {
  AiMarkIcon,
  Button,
  Chip,
  chosenBy,
  cn,
  CONCEPT_ICONS,
  placeVideo,
  toSeconds,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import { useMediaUrls } from '../../services/provider';
import { formatSeconds } from '../shared/format';
import { MakePoster } from './make-poster';

const BeatIcon = CONCEPT_ICONS.beat;
const StyleIcon = CONCEPT_ICONS.styleProfile;

interface FeaturedCut {
  readonly summary: TimelineSummary | null;
  readonly timeline: Timeline | null;
}

export function MakeStudioLead({ projects }: { projects: readonly ProjectSummary[] }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const media = useMediaUrls();

  const featured = useMemo(
    () => projects.find((project) => project.timelines > 0) ?? projects[0] ?? null,
    [projects],
  );

  const cut = useRpcQuery<FeaturedCut>(
    async (signal) => {
      if (!featured) return { summary: null, timeline: null };
      const summaries = await backend.timelines.listByProject({ projectId: featured.id }, { signal });
      const newest = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
      const timeline = newest ? await backend.timelines.get({ timelineId: newest.id }, { signal }) : null;
      return { summary: newest, timeline };
    },
    [backend, featured?.id, featured?.updatedAt],
  );

  const totals = useMemo(() => {
    let activeProjects = 0;
    let totalTimelines = 0;
    let totalExports = 0;
    for (const project of projects) {
      if (project.timelines > 0) activeProjects += 1;
      totalTimelines += project.timelines;
      totalExports += project.renders;
    }
    return { activeProjects, totalTimelines, totalExports };
  }, [projects]);

  if (!featured) return null;

  const newest = cut.stale ? null : (cut.data?.summary ?? null);
  const timeline = cut.stale ? null : (cut.data?.timeline ?? null);
  const placed = timeline ? placeVideo(timeline).items : [];
  const clips = placed.filter((item) => item.kind === 'clip');
  const yoursCount = timeline
    ? clips.filter((item) => item.kind === 'clip' && chosenBy(timeline, item.clip.id) === 'you').length
    : 0;
  const aiCount = Math.max(0, clips.length - yoursCount);
  const yoursFormatted = i18n.number(yoursCount);
  const aiFormatted = i18n.number(aiCount);
  const length = newest ? formatSeconds(i18n, toSeconds(newest.duration)) : null;
  const poster = featured.poster ? media.derived(featured.poster) : null;

  return (
    <section
      aria-label={t`Active studio cut`}
      data-slot="make-studio-lead"
      className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(17rem,1fr)]"
    >
      {/* Featured Active Cut Workbench */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-rule bg-raised p-4 shadow-xs sm:p-5">
        <div className="flex items-start gap-4">
          <MakePoster
            url={poster}
            empty={featured.timelines === 0}
            emptyIcon={CONCEPT_ICONS.project}
            loading={cut.status === 'loading' && !cut.data}
            size="featured"
            trackSlots={false}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={featured.timelines > 0 ? 'you' : 'neutral'}>
                  {featured.timelines > 0 ? t`Active cut` : t`Draft project`}
                </Chip>
                {length ? <span className="type-data text-ink-2">{length}</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm" icon={VERB_ICONS.open}>
                  <Link
                    to="/projects/$projectId/timeline"
                    params={{ projectId: featured.id }}
                    search={newest ? { timeline: newest.id } : {}}
                  >{t`Continue editing`}</Link>
                </Button>
                {newest ? (
                  <Button asChild size="sm" variant="ghost" icon={VERB_ICONS.export}>
                    <Link
                      to="/projects/$projectId/timeline"
                      params={{ projectId: featured.id }}
                      search={{ timeline: newest.id, export: true }}
                    >{t`Export…`}</Link>
                  </Button>
                ) : null}
              </div>
            </div>

            <h2 className="m-0 truncate type-section text-ink">
              <UserContent translate="no">{featured.name}</UserContent>
            </h2>

            <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-meta text-ink-2">
              {clips.length > 0 ? (
                <>
                  <span>
                    <Plural value={clips.length} one="# shot" other="# shots" />
                  </span>
                  <span aria-hidden>·</span>
                  <span className="font-medium text-you-strong">{t`${yoursFormatted} picked by you`}</span>
                  <span aria-hidden>·</span>
                  <span className="font-medium text-ai-strong">{t`${aiFormatted} by Taalcut`}</span>
                </>
              ) : (
                <span>
                  <Plural value={featured.timelines} one="# video" other="# videos" />
                </span>
              )}
              {featured.renders > 0 ? (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    <Plural value={featured.renders} one="# export" other="# exports" />
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        {/* Studio Rhythm & Attribution Rail */}
        {placed.length > 0 && timeline ? (
          <div className="flex flex-col gap-2 rounded-lg bg-sunken px-3.5 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 type-meta text-ink-2">
                <BeatIcon aria-hidden className="size-3.5 text-beat-strong" />
                <Trans>Scene rhythm & cut ownership</Trans>
              </span>
              <div className="flex flex-wrap items-center gap-3 type-meta text-ink-2">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2 rounded-pill bg-ai-strong" />
                  <Trans>Taalcut pick</Trans>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2 rounded-pill bg-you-strong" />
                  <Trans>Your pick</Trans>
                </span>
              </div>
            </div>
            <div aria-hidden className="flex h-3 w-full items-center gap-0.5 overflow-hidden rounded-sm">
              {placed.map((item) => {
                const by = item.kind === 'clip' ? chosenBy(timeline, item.clip.id) : null;
                return (
                  <span
                    key={item.kind === 'clip' ? item.clip.id : item.id}
                    style={{ flexGrow: item.frames, flexBasis: 0 }}
                    className={cn(
                      'h-full min-w-1 rounded-[2px]',
                      item.kind === 'gap'
                        ? 'border border-dashed border-rule'
                        : by === 'you'
                          ? 'bg-you-strong'
                          : 'bg-ai-strong',
                    )}
                  />
                );
              })}
            </div>
            <div aria-hidden className="flex items-center justify-between px-0.5">
              {Array.from({ length: Math.min(16, Math.max(8, placed.length)) }, (_, idx) => (
                <span
                  key={idx}
                  className={cn(
                    'w-0.5 rounded-pill',
                    idx % 4 === 0 ? 'h-2 bg-beat-strong' : 'h-1 bg-rule-strong',
                  )}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Studio Balance & Craft Summary */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-rule bg-raised p-4 shadow-xs sm:p-5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="type-card-title text-ink">{t`Studio overview`}</span>
            <Chip tone="ai">
              <AiMarkIcon aria-hidden className="size-3.5" />
              {t`Co-cut`}
            </Chip>
          </div>
          <p className="m-0 type-meta text-ink-2">
            <Trans>Active cuts, timeline versions and finished exports across your workbench.</Trans>
          </p>
        </div>

        <dl className="m-0 grid grid-cols-3 gap-2.5 rounded-lg bg-sunken p-3">
          <div className="flex flex-col gap-0.5">
            <dt className="type-meta text-ink-2">{t`Active cuts`}</dt>
            <dd className="m-0 type-section type-data text-you-strong">
              {i18n.number(totals.activeProjects)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="type-meta text-ink-2">{t`Timelines`}</dt>
            <dd className="m-0 type-section type-data text-ai-strong">
              {i18n.number(totals.totalTimelines)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="type-meta text-ink-2">{t`Exports`}</dt>
            <dd className="m-0 type-section type-data text-ink">{i18n.number(totals.totalExports)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule-subtle pt-3">
          <span className="inline-flex items-center gap-1.5 type-meta text-ink-2">
            <StyleIcon aria-hidden className="size-3.5 text-ink-3" />
            <Trans>Pacing learned from your cuts</Trans>
          </span>
          <Button asChild size="sm" variant="ghost" icon={StyleIcon}>
            <Link to="/projects/style">{t`Inspect your style`}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
