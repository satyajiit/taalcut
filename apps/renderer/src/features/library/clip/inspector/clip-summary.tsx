// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: what Taalcut saw in the clip (UX4, LIB1-FIND) · mode: Operate · system: DESIGN.md v0.7 (type roles, the
 *   kit's EmptyState and Chip)
 * the inspector's lead: Taalcut's sentence for the clip led by the AI mark (violet, its job); then what's happening,
 *   in rose (people on this page): how many people, with a person glyph, and what they're doing, each a word; then
 *   the things in it as neutral chips. A fixed action is translated; a free one the model needed, like the objects
 *   and the sentence, is shown as written (translate="no")
 * states: described · not described yet (one ink-3 line while the step is to come) · skipped (the compact empty
 *   state saying why: the describing model wasn't ready when Taalcut looked, with Analyse again; no model on this
 *   Mac that can, or frames it may not send online, with a link to Settings › Models) · nothing found (the compact
 *   empty state with Kaatu: what it means and that the clip is still usable). A skip read as "nothing found" told
 *   the PO there was nothing in a clip that hadn't been looked at.
 *   · interactive n/a (words and chips)
 * contrast: the sentence ink ≥ 7:1; chips ink-2 on sunken and rose-strong on rose-soft ≥ 4.5:1
 */
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { SHOT_ACTIONS, type AssetDetail, type ShotAnalysis } from '@taalcut/core';
import { AiMark, Button, Chip, EmptyState, errorMessage, toast, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { actionWords } from '../../shot-action-labels';
import { pending } from '../clip-facts-data';
import { useReanalyse } from '../progress/use-reanalyse';

type Skip = NonNullable<ShotAnalysis['descriptionSkipped']>;

/** The most actions the summary shows: a shot's own limit. */
const ACTIONS_SHOWN = 8;

/** What people in the clip's shots are doing: the fixed words first, in the vocabulary's order, then free ones. */
function clipActions(analyses: readonly ShotAnalysis[]): string[] {
  const all = new Set(analyses.flatMap((analysis) => analysis.description?.actions ?? []));
  const fixed = SHOT_ACTIONS.filter((action) => all.has(action));
  const free = [...all].filter((action) => !(SHOT_ACTIONS as readonly string[]).includes(action));
  return [...fixed, ...free].slice(0, ACTIONS_SHOWN);
}

function ModelsLink({ children }: { children?: React.ReactNode }) {
  return (
    <Link to="/settings/models" className="font-medium text-ink underline underline-offset-4">
      {children}
    </Link>
  );
}

/**
 * Why the describe step left the clip without words, in the person's terms, with the way on. The sentences that
 * name the Mac have their other computers' words in library-platform-words.ts.
 */
function NotDescribed({ detail, skip }: { detail: AssetDetail; skip: Skip }) {
  const { t, i18n } = useLingui();
  // Analyse again, shared with the page's other ways to it (LIB1-PROG): once asked, it isn't offered again.
  const reanalysis = useReanalyse(detail.asset.id, detail);
  const copy: Record<Skip, { title: string; description: React.ReactNode }> = {
    not_yet: {
      title: t`Taalcut couldn’t describe this clip yet.`,
      description: t`The model that describes clips wasn’t ready when Taalcut looked at it. Analyse it again to describe it.`,
    },
    no_local_model: {
      title: t`This Mac has no model that can describe clips.`,
      description: (
        <Trans>
          Choose one in <ModelsLink>Settings › Models</ModelsLink>, then analyse the clip again.
        </Trans>
      ),
    },
    no_consent: {
      title: t`Describing this clip would send its frames online, which you haven’t allowed.`,
      description: (
        <Trans>
          To describe clips on this Mac instead, choose a model in <ModelsLink>Settings › Models</ModelsLink>.
        </Trans>
      ),
    },
  };
  // The way on goes under the words: beside them, the inspector's narrow column squeezed them to a few per line.
  return (
    <div data-slot="clip-summary" data-empty data-skipped={skip} className="flex flex-col items-start gap-2">
      <EmptyState
        variant="compact"
        kaatu="idle"
        title={copy[skip].title}
        description={copy[skip].description}
        className="py-0"
      />
      {skip === 'not_yet' ? (
        <Button
          size="sm"
          variant="secondary"
          icon={VERB_ICONS.checkAgain}
          loading={reanalysis.busy}
          disabled={!reanalysis.available && !reanalysis.busy}
          onClick={() =>
            void reanalysis.run().then((result) => {
              if (result.error)
                toast({
                  tone: 'danger',
                  title: t`Couldn’t start analysing this clip again`,
                  description: errorMessage(i18n, result.error),
                });
            })
          }
        >
          {t`Analyse again`}
        </Button>
      ) : null}
    </div>
  );
}

export function ClipSummary({ detail }: { detail: AssetDetail }) {
  const { t, i18n } = useLingui();
  const analyses = detail.shots.map((shot) => shot.analysis).filter((analysis) => analysis !== null);
  const objects = [...new Set(analyses.flatMap((analysis) => analysis.description?.objects ?? []))].slice(
    0,
    10,
  );
  const people = Math.max(0, ...analyses.map((analysis) => analysis.description?.people ?? 0));
  const actions = clipActions(analyses);
  const { description } = detail.asset;

  if (!description && pending(detail, 'vision.'))
    return (
      <p data-slot="clip-summary" className="m-0 type-body text-ink-3">
        {t`Taalcut hasn’t described this clip yet.`}
      </p>
    );
  // Skipped, not looked at: say why, with the way on.
  const skip = analyses.find((analysis) => analysis.descriptionSkipped)?.descriptionSkipped;
  if (!description && skip) return <NotDescribed detail={detail} skip={skip} />;
  // Looked at, and nothing found to say: the kit's empty state, beside the picture (never over it).
  if (!description)
    return (
      <div data-slot="clip-summary" data-empty>
        <EmptyState
          variant="compact"
          kaatu="idle"
          title={t`Taalcut didn’t find anything to describe in this clip.`}
          description={t`You can still use it in a video, and find it by its name or its date.`}
          className="py-0"
        />
      </div>
    );

  return (
    <section aria-label={t`What Taalcut saw`} data-slot="clip-summary" className="flex flex-col gap-3">
      <p className="m-0 flex items-start gap-2 type-body text-ink">
        <AiMark className="mt-1 size-3.5 shrink-0" label={t`Described by Taalcut`} />
        <UserContent translate="no" className="max-w-prose">
          {description}
        </UserContent>
      </p>
      {people > 0 || actions.length > 0 ? (
        <ul aria-label={t`What’s happening`} className="m-0 flex list-none flex-wrap gap-1.5 p-0 ps-5.5">
          {people > 0 ? (
            <li>
              <Chip className="bg-rose-soft text-rose-strong">
                <Users aria-hidden />
                {t`${plural(people, { one: 'One person', other: '# people' })}`}
              </Chip>
            </li>
          ) : null}
          {actions.map((action) => {
            const words = actionWords(i18n, action);
            return (
              <li key={action} data-slot="clip-action">
                <Chip
                  className="bg-rose-soft text-rose-strong"
                  {...(words.raw ? { translate: 'no' as const, 'data-user-content': true } : {})}
                >
                  {words.label}
                </Chip>
              </li>
            );
          })}
        </ul>
      ) : null}
      {objects.length > 0 ? (
        <ul aria-label={t`In this clip`} className="m-0 flex list-none flex-wrap gap-1.5 p-0 ps-5.5">
          {objects.map((object) => (
            <li key={object}>
              <Chip translate="no" data-user-content>
                {object}
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
