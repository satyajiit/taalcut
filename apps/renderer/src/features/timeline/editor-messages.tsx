// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: editor messages · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.4
 * what the editor says instead of the editor, as DESIGN's message pages do: plain text from the content's start, a
 *   heading, one sentence, one way on. Gone: the project left (Back to Make). Didn't open: a read failed (the
 *   project, its videos, or the open video's watch): the cause and Try again, which reads everything again and
 *   reopens the watch; never an empty timeline that isn't one
 * states: default · the Button's and ErrorLine's eight · pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { Trans } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AREAS } from '../../shell/areas';
import { LoadError } from '../make/load-error';

function Message({ slot, title, children }: { slot: string; title: ReactNode; children: ReactNode }) {
  return (
    <div data-slot={slot} className="flex flex-1 flex-col items-start justify-center gap-3 px-10">
      <h2 className="m-0 text-xl font-semibold text-ink">{title}</h2>
      {children}
    </div>
  );
}

export function ProjectGone() {
  const make = AREAS.find((area) => area.id === 'make');
  return (
    <Message slot="project-gone" title={<Trans>This project isn’t here any more</Trans>}>
      <p className="m-0 max-w-prose text-sm text-ink-2">
        <Trans>It may have been deleted, or it is on another Mac. Your other projects are in Make.</Trans>
      </p>
      <Button asChild variant="secondary">
        <Link to={make?.to ?? '/projects'}>
          <Trans>Back to Make</Trans>
        </Link>
      </Button>
    </Message>
  );
}

/** A read the editor needs failed: what failed, and Try again (which reopens the open video's watch too). */
export function EditorFailed({
  what,
  error,
  onRetry,
}: {
  what: 'project' | 'videos' | 'video';
  error: TaalcutError;
  onRetry: () => void;
}) {
  const title =
    what === 'project' ? (
      <Trans>This project didn’t open</Trans>
    ) : what === 'videos' ? (
      <Trans>This project’s videos didn’t load</Trans>
    ) : (
      <Trans>This video didn’t open</Trans>
    );
  return (
    <Message slot="editor-failed" title={title}>
      <LoadError error={error} onRetry={onRetry} />
    </Message>
  );
}
