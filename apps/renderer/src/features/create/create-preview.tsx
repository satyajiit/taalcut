// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { AssetId, TaalcutError } from '@taalcut/core';
import { CONCEPT_ICONS, cn } from '@taalcut/ui';
import { useEffect } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { useMediaUrls } from '../../services/provider';
import { LoadError, Loading } from '../settings/fields';

export function CreationPreview({ assetId, compact = false }: { assetId: AssetId; compact?: boolean }) {
  const { t } = useLingui();
  const backend = useBackend();
  const media = useMediaUrls();
  const detail = useRpcQuery((signal) => backend.library.asset({ assetId }, { signal }), [backend, assetId]);
  const thumbnail = detail.data?.asset.thumbnail;
  const src = thumbnail ? media.derived(thumbnail) : null;
  useBackendEvents(['library.changed'], ({ payload }) => {
    if (payload.ids.includes(assetId)) detail.reload();
  });
  const waiting = detail.status === 'ready' && !thumbnail;
  const Image = CONCEPT_ICONS.image;
  useEffect(() => {
    if (!waiting) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      detail.reload();
      if (++attempts >= 30) window.clearInterval(timer);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [waiting, detail.reload]);
  return (
    <section
      className={cn('flex w-full min-w-0 flex-col gap-3', compact && 'h-full min-h-0 justify-center')}
      aria-label={t`Visual preview`}
    >
      {!compact ? (
        <h2 className="m-0 flex items-center gap-2 type-card-title text-ink">
          <Image aria-hidden className="size-4 text-ink-3" />
          {t`Visual preview`}
        </h2>
      ) : null}
      {detail.status === 'loading' ? <Loading /> : null}
      {detail.status === 'error' ? (
        <PreviewFailure error={detail.error} compact={compact} onRetry={detail.reload} />
      ) : null}
      {src ? (
        <img
          className={cn(
            'w-full rounded-lg bg-well object-contain',
            compact ? 'h-full max-h-full' : 'max-h-96',
          )}
          src={src}
          alt={t`Proposed visual direction`}
        />
      ) : detail.data ? (
        <p className="type-body text-ink-2">{t`The visual preview is being prepared.`}</p>
      ) : null}
    </section>
  );
}

function PreviewFailure({
  error,
  compact,
  onRetry,
}: {
  error: TaalcutError;
  compact: boolean;
  onRetry: () => void;
}) {
  const { t } = useLingui();
  if (compact) return <p className="m-0 type-meta text-ink-2">{t`The visual preview didn’t load.`}</p>;
  return <LoadError error={error} onRetry={onRetry} what={t`The visual preview didn’t load.`} />;
}
