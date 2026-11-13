// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the clip page's loading view · genre: atmospheric studio app · system: DESIGN.md v0.4
 * states: loading only (the page's captured bones under the window bar's name, at once: no spinner, no delay)
 * motion: the bones' own pulse (tc-bone); reduced motion keeps it slower, as every loader
 * pre-emit critique: P5 H4 E5 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { Skeleton } from '@taalcut/ui';
import { Page } from '../../../shell/page';

/** The clip page's content: a container for the layout's queries, on the page grid's `wide` column (UX4). */
export const CLIP_FRAME = '@container';

/**
 * The clip page while its code loads: the window bar's name and the page's bones, shown at once (the route's
 * pending view). Its own small module, so the route's entry doesn't carry the page's code.
 */
export function ClipPending() {
  const { t } = useLingui();
  return (
    <Page title={t`Library`} width="wide" className={CLIP_FRAME}>
      <Skeleton name="clip-page" loading>
        {null}
      </Skeleton>
    </Page>
  );
}
