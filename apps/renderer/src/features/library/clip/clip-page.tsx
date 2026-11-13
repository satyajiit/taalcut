// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · page: a clip (/library/:assetId, P2-L11; redesigned UX1) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.4 · macrostructure: the editor's family (viewer over a timeline bed,
 *   held in view; facts, the shot and what's said in the column beside) · the window bar names it (Library › the file) and holds its actions; the shell's back and
 *   forward are the way out (no button of our own)
 * states: loading (boneyard bones captured from this layout, at once) · filled · still being looked at (the status
 *   line; each part not done says so, and looking at it asks indexing to do it next) · searchable (IX-R3) · failed
 *   (where it stopped; Try again, or Analyse again when only a fresh start can help) · original offline, missing (Look again), only in iCloud, removed (Put
 *   it back) · no shots, no speech, no sound · photo · not found (the kit's empty state: Kaatu oops, a heading, one
 *   sentence, Go to Library) · error (the empty state in danger: the cause, Try again)
 */
import { useLingui } from '@lingui/react/macro';
import { callRpc, type AssetId, type TaalcutError } from '@taalcut/core';
import {
  Button,
  CONCEPT_ICONS,
  EmptyState,
  errorMessage,
  Skeleton,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { Page } from '../../../shell/page';
import { CLIP_FIXTURE } from './clip-fixture';
import { prefetchedClip } from './clip-prefetch';
import { CLIP_FRAME } from './clip-pending';
import { useCloseIntoTile } from './clip-transition';
import { ClipView } from './clip-view';
import type { RetryKind } from './inspector/clip-status';
import { useReanalyse } from './progress/use-reanalyse';
import { useClipDetail } from './use-clip-detail';

/** A clip that isn't in the library (removed, or its folder taken out): the kit's empty state, Kaatu and one way on. */
function ClipGone() {
  const { t } = useLingui();
  return (
    <Page title={t`Library`} width="wide">
      <div data-slot="clip-gone" className="pt-[min(10vh,5rem)]">
        <EmptyState
          kaatu="oops"
          icon={CONCEPT_ICONS.clip}
          title={t`This clip isn’t in your library any more`}
          description={t`It may have been removed, or its folder taken out of the library.`}
          action={
            <Button asChild size="sm" variant="secondary" icon={CONCEPT_ICONS.library}>
              <Link to="/library">{t`Go to Library`}</Link>
            </Button>
          }
        />
      </div>
    </Page>
  );
}

export function ClipPage({ assetId }: { assetId: AssetId }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const detail = useClipDetail(assetId);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<TaalcutError | null>(null);
  // The clip as its tile read it ahead (clip-prefetch.ts): the first frame draws the picture and the facts from it,
  // so the frame grows at once (B18). The page's own read takes over when it lands.
  const [ahead] = useState(() => prefetchedClip(assetId));
  // Only this clip's data: a query that keeps the last answer while it asks again never shows another clip's.
  const data = detail.data?.asset.id === assetId ? detail.data : ahead;
  useCloseIntoTile(assetId, data !== undefined);
  // Analyse again, shared with the bar's More menu (LIB1-PROG): busy until the clip's steps say it runs.
  const reanalysis = useReanalyse(assetId, data, detail.refresh);

  if (!data && detail.error?.code === 'core.not_found') return <ClipGone />;
  if (!data && detail.error)
    return (
      <Page title={t`Library`} width="wide" className={CLIP_FRAME}>
        <div data-slot="clip-error" className="pt-[min(10vh,5rem)]">
          <EmptyState
            kaatu="oops"
            title={t`Taalcut couldn’t open this clip`}
            description={errorMessage(i18n, detail.error)}
            action={
              <Button size="sm" icon={VERB_ICONS.retry} onClick={detail.reload}>
                {t`Try again`}
              </Button>
            }
          />
        </div>
      </Page>
    );

  const failed = data?.stages.find((stage) => stage.state === 'failed');
  const sourceId = data?.asset.sourceIds[0];
  // A step that may pass next time runs again; one that can't as things are starts the clip over.
  const retryKind: RetryKind = failed?.error?.retryable ? 'retry' : 'reanalyse';
  const retry = async () => {
    if (retryKind === 'reanalyse') return void reanalysis.run();
    setRetrying(true);
    const result = await callRpc(backend.indexing.retryFailed(sourceId ? { sourceId } : {}));
    setRetrying(false);
    setRetryError(result.ok ? null : result.error);
    if (result.ok) detail.refresh();
  };

  return (
    <Page
      title={t`Library`}
      {...(data ? { detail: <UserContent translate="no">{data.asset.name}</UserContent> } : {})}
      width="wide"
      className={CLIP_FRAME}
    >
      <Skeleton name="clip-page" loading={!data} fixture={<ClipView detail={CLIP_FIXTURE} fixture />}>
        {data ? (
          <ClipView
            key={data.asset.id}
            detail={data}
            retrying={retryKind === 'reanalyse' ? reanalysis.busy : retrying}
            retryError={retryKind === 'reanalyse' ? reanalysis.error : retryError}
            onRetry={failed ? () => void retry() : undefined}
            retryKind={retryKind}
            // Not offered on the picture while Taalcut already looks at the clip: the status says what it redoes.
            reanalyse={
              reanalysis.available || reanalysis.busy || reanalysis.error
                ? { run: () => void reanalysis.run(), pending: reanalysis.busy, error: reanalysis.error }
                : null
            }
          />
        ) : null}
      </Skeleton>
    </Page>
  );
}
