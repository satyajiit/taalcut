// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { CardOf, TaalcutError } from '@taalcut/core';
import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '#components/button';
import { useFormatters } from '#lib/format';
import { useShotFrames } from '../make/use-shot-frames';
import { useCardActions } from './card-actions';
import { useCardData } from './card-data';
import { UserContent } from './card-frame';
import { ErrorLine } from './error-line';

type SavedCover = NonNullable<CardOf<'toolRun'>['savedCover']>;

/** A committed JPEG remains usable even when its originating chat run was stopped. */
export function SavedCoverResult({ cover }: { cover: SavedCover }) {
  const { t } = useLingui();
  const format = useFormatters();
  const actions = useCardActions();
  const { watchAssetImage } = useCardData();
  const [image, setImage] = useState<{ assetId: string; url: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  useEffect(
    () =>
      cover.assetId && watchAssetImage
        ? watchAssetImage(cover.assetId, (url) => setImage({ assetId: cover.assetId!, url }))
        : undefined,
    [cover.assetId, watchAssetImage],
  );
  const shot = cover.assetId ? { assetId: cover.assetId, shotId: null } : null;
  const frameFor = useShotFrames(shot ? [shot] : []);
  const url = image?.assetId === cover.assetId ? image?.url : shot ? frameFor(shot)?.url : null;
  const save = async () => {
    if (!actions.saveExportAs || savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await actions.saveExportAs(cover.fileName);
      if (!result.ok) setError(result.error);
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  };
  const width = format.count(cover.width);
  const height = format.count(cover.height);
  return (
    <section
      data-slot="saved-cover-result"
      data-card-type="toolRun"
      aria-label={t`Saved cover`}
      className="flex min-w-0 flex-col items-start gap-3"
    >
      {url ? (
        <img
          src={url}
          alt={t`Exported cover`}
          width={cover.width}
          height={cover.height}
          className="max-h-80 max-w-full rounded-lg object-contain"
        />
      ) : null}
      <div className="flex min-w-0 max-w-full flex-col gap-1">
        <p className="m-0 break-words type-label text-ink">
          <UserContent>{cover.fileName}</UserContent>
        </p>
        <p className="m-0 type-meta text-ink-2">{t`JPEG · ${width} × ${height}`}</p>
      </div>
      {actions.saveExportAs ? (
        <Button size="sm" variant="secondary" loading={saving} icon={Download} onClick={() => void save()}>
          {t`Save JPEG`}
        </Button>
      ) : null}
      {error ? <ErrorLine key={error.code} error={error} onReport={actions.report} /> : null}
    </section>
  );
}
