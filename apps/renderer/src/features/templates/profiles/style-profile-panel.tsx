// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a set's style profile on its page (LRN1-STY) · genre: atmospheric studio app
 * system: DESIGN.md v0.4 · StyleProfileSummary (packages/ui) fed live: the contact sheets through the media host,
 *   Open goes to the template's page, Try again asks for the summary again. Shown where each set lives: a Saved
 *   collection's page, a folder's or one tag's view of Templates, and Make's Exports
 * states: loading (Skeleton "style-profile" over StyleProfileBones, the summary's own shape, drawn by hand: no
 *   captured route shows the card while bones are captured; another set's answer is never shown as this one's) ·
 *   error with no answer
 *   (ErrorLine + Try again) · a failed re-read (the answer stays, the cause above it) · refreshing (aria-busy) ·
 *   every state of the summary (StyleProfileSummary); with hideWhenEmpty, an empty set is nothing at all
 */
import type { StyleSource } from '@taalcut/core';
import { ErrorLine, Skeleton, StyleProfileBones, StyleProfileSummary } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMediaUrls } from '../../../services/provider';
import { useStyleProfile } from './use-style-profile';

interface StyleProfilePanelProps {
  readonly source: StyleSource;
  /** The title's level: a page's own section (2), or one inside a section with its own heading (3). */
  readonly level?: 2 | 3;
  /**
   * An empty set shows nothing: for a page whose own empty state already says what to do (a folder's, a tag's,
   * Exports). The Saved page keeps the card's line, since it says how a saved Reel becomes a template.
   */
  readonly hideWhenEmpty?: boolean;
}

export function StyleProfilePanel({ source, level = 2, hideWhenEmpty = false }: StyleProfilePanelProps) {
  const { state, asking, askFailure, writeAgain } = useStyleProfile(source);
  const media = useMediaUrls();
  const navigate = useNavigate();
  if (hideWhenEmpty && state.data?.profile === null) return null;
  if (state.error && !state.data)
    return (
      <div data-slot="style-profile-error" className="rounded-lg border border-rule bg-raised p-4 shadow-xs">
        <ErrorLine error={state.error} onRetry={state.reload} />
      </div>
    );
  return (
    <Skeleton name="style-profile" loading={state.status === 'loading'} fallback={<StyleProfileBones />}>
      <div className="flex flex-col gap-2">
        {state.error ? <ErrorLine error={state.error} onRetry={state.reload} /> : null}
        {state.data ? (
          <StyleProfileSummary
            view={state.data}
            level={level}
            sheetUrl={(sheet) => media.templateAsset(sheet)}
            onOpenTemplate={(templateId) =>
              void navigate({ to: '/templates/$templateId', params: { templateId } })
            }
            onWriteAgain={writeAgain}
            asking={asking}
            askFailure={askFailure}
            refreshing={state.refreshing === true}
          />
        ) : null}
      </div>
    </Skeleton>
  );
}
