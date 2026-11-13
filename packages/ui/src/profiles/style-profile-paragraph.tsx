// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: style profile summary paragraph (LRN1-STY) · genre: atmospheric studio app
 * system: DESIGN.md v0.4 · a model's words, so led by the AI mark (violet, the one accent here) and shown as written
 *   (plain text, never translated); under them where they were written, on this Mac or by a cloud model with the
 *   person's standing permission. Honest when there is none: why, in one plain sentence, and Try again
 * states: writing (a neutral spinner: a background job, never violet) · written on this Mac · written in the cloud ·
 *   no model (none here, no permission for the cloud) · not yet (the model is still getting ready) · failed (the
 *   cause and Try again) · asking again (Try again loading) · the ask failed (its cause under the line) · Try again
 *   carries Button's eight states
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { StyleProfileSummary, TaalcutError } from '@taalcut/core';
import { LoaderCircle } from 'lucide-react';
import { UserContent } from '../cards/card-frame';
import { ErrorLine } from '../cards/error-line';
import { providerLabel } from '../cards/labels';
import { AiMark } from '../components/ai-mark';
import { Button } from '../components/button';
import { VERB_ICONS } from '../icons/concepts';

export interface StyleProfileParagraphProps {
  readonly summary: StyleProfileSummary;
  /** Writes the summary again (templates.writeStyleSummary); without it nothing offers to. */
  readonly onWriteAgain?: () => void;
  /** The ask to write it again is on its way. */
  readonly asking?: boolean;
  /** The ask itself failed. */
  readonly askFailure?: TaalcutError | null;
}

function TryAgain({ onWriteAgain, asking }: Pick<StyleProfileParagraphProps, 'onWriteAgain' | 'asking'>) {
  if (!onWriteAgain) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={asking === true}
      icon={VERB_ICONS.retry}
      onClick={onWriteAgain}
    >
      <Trans>Try again</Trans>
    </Button>
  );
}

function Written({ summary }: { summary: Extract<StyleProfileSummary, { state: 'written' }> }) {
  const { i18n } = useLingui();
  const model = summary.model;
  const provider = providerLabel(i18n, summary.provider);
  return (
    <div data-summary="written" className="flex flex-col gap-1.5">
      <p className="m-0 flex max-w-[65ch] gap-2 text-md text-ink">
        <AiMark className="mt-1 size-3.5" />
        <UserContent translate="no" dir="auto">
          {summary.text}
        </UserContent>
      </p>
      <p className="m-0 ps-5.5 text-xs text-ink-3" data-written={summary.local ? 'local' : 'cloud'}>
        {/* The model's and the provider's names are names: never translated. */}
        {summary.local ? (
          <Trans>
            Written on this Mac by <span translate="no">{model}</span>, from the most typical videos’ frames.
          </Trans>
        ) : (
          <Trans>
            Written by <span translate="no">{model}</span> (<span translate="no">{provider}</span>), which you
            allowed to see pictures.
          </Trans>
        )}
      </p>
    </div>
  );
}

/** What a model wrote about the set, or why nothing has been, with the way to ask again. */
export function StyleProfileParagraph({
  summary,
  onWriteAgain,
  asking,
  askFailure,
}: StyleProfileParagraphProps) {
  return (
    <div data-slot="style-profile-summary" className="flex flex-col items-start gap-2">
      {summary.state === 'writing' ? (
        <p role="status" data-summary="writing" className="m-0 flex items-center gap-2 text-sm text-ink-2">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          <Trans>Writing a summary from the most typical videos…</Trans>
        </p>
      ) : null}
      {summary.state === 'written' ? <Written summary={summary} /> : null}
      {summary.state === 'none' && summary.reason === 'no_model' ? (
        <>
          <p data-summary="no_model" className="m-0 max-w-[65ch] text-sm text-ink-2">
            <Trans>
              No summary in words: there’s no model on this Mac that can look at frames, and pictures go to a
              cloud model only with your permission. Everything above is measured, so it’s complete without
              one.
            </Trans>
          </p>
          <TryAgain onWriteAgain={onWriteAgain} asking={asking} />
        </>
      ) : null}
      {summary.state === 'none' && summary.reason === 'not_yet' ? (
        <>
          <p data-summary="not_yet" className="m-0 max-w-[65ch] text-sm text-ink-2">
            <Trans>The model on this Mac is still getting ready, so there’s no summary in words yet.</Trans>
          </p>
          <TryAgain onWriteAgain={onWriteAgain} asking={asking} />
        </>
      ) : null}
      {summary.state === 'failed' ? (
        <div data-summary="failed">
          <ErrorLine error={summary.error} {...(onWriteAgain ? { onRetry: onWriteAgain } : {})} />
        </div>
      ) : null}
      {askFailure ? <ErrorLine error={askFailure} /> : null}
    </div>
  );
}
