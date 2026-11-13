// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Make's empty states (UX4) · system: DESIGN.md v0.6 + UX4 kit (EmptyState)
 * one per Make view, each the kit's EmptyState: Kaatu beside the words (idle, asleep after a while; the words stay
 *   when Show Kaatu is off), the title (h2 under the bar's h1), one line that says what will be here and how it
 *   gets here, and the one action that fills it. Nothing made yet, nothing exported yet, nothing archived, and no
 *   style measured yet. A project's empty timeline is a work surface: no Kaatu there (DESIGN.md, Kaatu never over
 *   footage), only the ghost cut, the words and the way to the agent
 * states: n/a (static; the action is a Button or a link, which carry the eight states)
 */
import { Trans } from '@lingui/react/macro';
import { Button, CONCEPT_ICONS, EmptyState, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Blend } from 'lucide-react';
import { EmptyRecipes } from '../recipes/empty-recipes';
import type { RecipeContext } from '../recipes/recipe-filter';
import { GhostTimeline } from './ghost-timeline';

/** A project's page with nothing cut yet. */
const UNCUT_PROJECT: RecipeContext = { project: true, timeline: false, clipSelection: false };

/** The one way to start a video, from every Make view that has nothing in it. */
function MakeAVideo() {
  return (
    <Button asChild variant="primary" icon={VERB_ICONS.makeVideo}>
      <Link to="/chat">
        <Trans>Make a video</Trans>
      </Link>
    </Button>
  );
}

/** Make, before the first video: the cut it will become, then the one way to start one. */
export function ProjectsEmpty() {
  return (
    <EmptyState
      tone="make"
      title={<Trans>No projects yet</Trans>}
      description={
        <Trans>
          Every video you make becomes a project here, with its cuts, versions and exports. Start one from a
          chat.
        </Trans>
      }
      action={<MakeAVideo />}
    >
      <GhostTimeline />
    </EmptyState>
  );
}

/** Exports, before the first one: where they will land, and how to make one. */
export function RendersEmpty() {
  return (
    <EmptyState
      tone="make"
      title={<Trans>Your exports show up here</Trans>}
      description={
        <Trans>
          Finished videos land here, ready to post. Make one in a chat, then export it from its timeline.
        </Trans>
      }
      action={<MakeAVideo />}
    >
      <GhostTimeline />
    </EmptyState>
  );
}

/** Archived, with nothing put away: what archiving does, and how a project comes back. */
export function ArchivedEmpty() {
  return (
    <EmptyState
      tone="make"
      icon={CONCEPT_ICONS.archived}
      title={<Trans>Nothing archived</Trans>}
      description={
        <Trans>
          Archive a project from its More menu to put it away here. Nothing is deleted, and Bring back puts it
          with your projects again.
        </Trans>
      }
      action={
        <Button asChild variant="secondary" icon={CONCEPT_ICONS.project}>
          <Link to="/projects" search={{}}>
            <Trans>Your projects</Trans>
          </Link>
        </Button>
      }
    />
  );
}

/** Your style, before an export made from a template has finished: what will be measured here. */
export function StyleEmpty() {
  return (
    <EmptyState
      tone="make"
      icon={Blend}
      title={<Trans>Your style shows up here</Trans>}
      description={
        <Trans>
          Once you export videos made from templates, Taalcut measures what they have in common: shot length,
          cuts on the beat, how they open and how they sound.
        </Trans>
      }
      action={<MakeAVideo />}
    />
  );
}

/** A project's timeline before the agent has cut anything. Its recipes go to the project's chat. */
export function TimelineEmpty() {
  return (
    <EmptyState
      kaatu={false}
      title={<Trans>Nothing on the timeline yet</Trans>}
      description={
        <Trans>Ask the agent for a video, and its cut shows up here clip by clip, on the beat.</Trans>
      }
      action={
        <>
          <Button asChild variant="primary" icon={CONCEPT_ICONS.chat}>
            <Link to="/chat">
              <Trans>Ask the agent</Trans>
            </Link>
          </Button>
          <EmptyRecipes context={UNCUT_PROJECT} className="mt-1 basis-full" />
        </>
      }
    >
      <GhostTimeline size="full" />
    </EmptyState>
  );
}
