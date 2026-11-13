// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { CoverSettings, ThumbnailVariant, Timeline } from '@taalcut/core';
import { useState } from 'react';
import { Button } from '#components/button';
import { Input } from '#components/input';
import { VERB_ICONS } from '../icons/concepts';
import { useTimecode } from '../make/timecode';
import { MediaError } from '../media/media-lines';
import { useCommand } from '../media/use-command';
import { useCardActions } from './card-actions';
import { useCoverDrafts } from './use-cover-drafts';
import { useCoverImage } from './use-cover-image';
import { coverSafeInset } from './publish-thumbnail-layout';
import { CoverDesignFields } from './cover-design-fields';

export function coverFromVariant(variant: ThumbnailVariant): CoverSettings {
  return {
    aspect: variant.aspect,
    source: { kind: 'asset', assetId: variant.selectedAssetId },
    archetype: variant.archetype,
    theme: variant.theme,
    textAlign: variant.textAlign,
    hookText: variant.composition === 'complete' ? '' : variant.hookText,
    kickerText: variant.composition === 'complete' ? '' : (variant.kickerText ?? ''),
    statBadge: variant.composition === 'complete' ? '' : (variant.statBadge ?? ''),
  };
}

/** The editor and publishing cards use this same saved design and image renderer. */
export function CoverEditor({
  timeline,
  initial,
  variants = [],
  paused = false,
  currentFrame,
}: {
  timeline: Timeline;
  initial?: CoverSettings;
  variants?: readonly ThumbnailVariant[];
  paused?: boolean;
  currentFrame?: () => number;
}) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const actions = useCardActions();
  const command = useCommand();
  const fallback: CoverSettings = initial ?? {
    aspect: '9:16',
    source: { kind: 'frame', frame: currentFrame?.() ?? 0 },
    archetype: 'atmospheric-cinema',
    theme: 'golden-hour',
    textAlign: 'bottom-left',
    hookText: '',
    kickerText: '',
    statBadge: '',
  };
  const drafts = useCoverDrafts(timeline, fallback, (aspect) => {
    const variant = variants.find((item) => item.aspect === aspect);
    return variant
      ? {
          ...coverFromVariant(variant),
          ...(fallback.channel && variant.composition !== 'complete' ? { channel: fallback.channel } : {}),
        }
      : { ...fallback, aspect };
  });
  const { cover, saved, conflict, dirty, patch } = drafts;
  const [safe, setSafe] = useState(false);
  const [feed, setFeed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<Parameters<typeof MediaError>[0]['error'] | null>(null);
  const target = {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    revision: timeline.revision,
    aspect: cover.aspect,
  };
  const image = useCoverImage({ ...target, cover });
  const length =
    timeline.tracks[0]?.items.reduce(
      (sum, item) => sum + (item.type === 'clip' || item.type === 'gap' ? item.duration.value : 0),
      0,
    ) ?? 0;
  const frame = cover.source.kind === 'frame' ? cover.source.frame : 0;
  const frameTime = time.clock(frame, timeline.canvas.rate);
  const takeVariant = variants.find((variant) => variant.aspect === cover.aspect);
  const aspectLabels = {
    '16:9': t`16:9 YouTube`,
    '9:16': t`9:16 Shorts & Reels`,
    '4:5': t`4:5 IG Feed`,
    '1:1': t`1:1 IG Grid`,
  };
  const layouts = {
    'editorial-specimen': t`Editorial`,
    'brutal-slab': t`Bold`,
    'atmospheric-cinema': t`Atmospheric`,
    'minimal-frame': t`Minimal`,
    'stat-callout': t`Stat`,
  };
  const palettes = {
    'golden-hour': t`Golden hour`,
    midnight: t`Midnight`,
    newsprint: t`Newsprint`,
    studio: t`Studio`,
    terminal: t`Terminal`,
    'brand-kit': t`Brand`,
  };
  const channel = cover.channel ?? { name: '', handle: '', show: false };
  const save = async () => {
    await command.run('save-cover', 'timeline.setCover', { ...target, cover });
  };
  const exportImage = async () => {
    if (!actions.exportCover) return;
    setExporting(true);
    setExportError(null);
    const result = await actions.exportCover(target);
    if (!result.ok) setExportError(result.error);
    else if (actions.saveExportAs) {
      const savedFile = await actions.saveExportAs(result.value.fileName);
      if (!savedFile.ok) setExportError(savedFile.error);
    }
    setExporting(false);
  };
  return (
    <section aria-label={t`Choose cover`} className="flex flex-col gap-3" data-slot="cover-editor">
      <div className="flex flex-wrap gap-1" role="group" aria-label={t`Aspect ratio`}>
        {(Object.keys(aspectLabels) as CoverSettings['aspect'][]).map((aspect) => (
          <Button
            key={aspect}
            size="sm"
            variant="ghost"
            disabled={paused}
            aria-pressed={cover.aspect === aspect}
            onClick={() => drafts.select(aspect)}
          >
            {aspectLabels[aspect]}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={paused || length === 0}
          onClick={() =>
            patch({
              source: { kind: 'frame', frame: Math.min(currentFrame?.() ?? frame, Math.max(0, length - 1)) },
            })
          }
        >{t`Use video frame`}</Button>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={safe}
          onClick={() => setSafe(!safe)}
        >{t`Safe zones`}</Button>
        <Button size="sm" variant="ghost" aria-pressed={feed} onClick={() => setFeed(!feed)}>
          {feed ? t`Canvas` : t`Feed preview`}
        </Button>
      </div>
      {cover.source.kind === 'frame' ? (
        <label className="flex flex-col gap-1 type-label">
          {t`Video frame · ${frameTime}`}
          <input
            aria-label={t`Cover frame`}
            type="range"
            min={0}
            max={Math.max(0, length - 1)}
            step={1}
            value={frame}
            disabled={paused}
            onChange={(event) => patch({ source: { kind: 'frame', frame: Number(event.target.value) } })}
          />
        </label>
      ) : null}
      <div className={feed ? 'mx-auto w-full max-w-48' : 'mx-auto w-full max-w-sm'}>
        <div
          className="relative overflow-hidden rounded-lg bg-viewer"
          style={{ aspectRatio: cover.aspect.replace(':', '/') }}
          aria-busy={image.busy}
        >
          {image.url ? (
            <img src={image.url} alt={t`Cover preview`} className="size-full object-contain" />
          ) : (
            <p className="p-4 type-meta text-viewer-ink">
              {image.available ? t`Preparing cover…` : t`Cover preview is unavailable here`}
            </p>
          )}
          {safe ? (
            <div
              aria-hidden
              className="pointer-events-none absolute border-2 border-dashed border-marigold"
              style={coverSafeInset(cover.aspect)}
            />
          ) : null}
        </div>
        {feed ? <p className="mt-2 type-label">{cover.hookText || timeline.name}</p> : null}
      </div>
      <p role="status" className="m-0 type-meta text-ink-2">
        {image.busy && image.available
          ? t`Updating cover preview…`
          : t`Preview and JPEG use the same full-resolution design.`}
      </p>
      {image.error ? (
        <>
          <MediaError error={image.error} />
          <Button size="sm" variant="secondary" onClick={image.retry}>{t`Try preview again`}</Button>
        </>
      ) : null}
      {cover.design ? (
        <CoverDesignFields design={cover.design} paused={paused} onChange={(design) => patch({ design })} />
      ) : (
        <>
          <label className="flex flex-col gap-1 type-label">
            {t`Cover words`}
            <Input
              value={cover.hookText}
              maxLength={48}
              disabled={paused}
              onChange={(event) => patch({ hookText: event.target.value })}
            />
          </label>
          <details>
            <summary className="cursor-pointer type-label">{t`Design and channel`}</summary>
            <div className="flex flex-col gap-3 pt-3">
              <label className="flex flex-col gap-1 type-label">
                {t`Layout`}
                <select
                  value={cover.archetype}
                  disabled={paused}
                  onChange={(event) => patch({ archetype: event.target.value as CoverSettings['archetype'] })}
                >
                  {Object.entries(layouts).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 type-label">
                {t`Palette`}
                <select
                  value={cover.theme}
                  disabled={paused}
                  onChange={(event) => patch({ theme: event.target.value as CoverSettings['theme'] })}
                >
                  {Object.entries(palettes).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 type-label">
                {t`Text position`}
                <select
                  value={cover.textAlign}
                  disabled={paused}
                  onChange={(event) => patch({ textAlign: event.target.value as CoverSettings['textAlign'] })}
                >
                  <option value="top-left">{t`Top`}</option>
                  <option value="bottom-left">{t`Bottom`}</option>
                  <option value="left">{t`Left`}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 type-label">
                {t`Short label`}
                <Input
                  value={cover.kickerText}
                  maxLength={28}
                  disabled={paused}
                  onChange={(event) => patch({ kickerText: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 type-label">
                {t`Highlight`}
                <Input
                  value={cover.statBadge}
                  maxLength={20}
                  disabled={paused}
                  onChange={(event) => patch({ statBadge: event.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 type-label">
                <input
                  type="checkbox"
                  checked={channel.show}
                  disabled={paused}
                  onChange={(event) => patch({ channel: { ...channel, show: event.target.checked } })}
                />
                {t`Channel badge`}
              </label>
              <Input
                aria-label={t`Channel name`}
                value={channel.name}
                maxLength={60}
                disabled={paused}
                onChange={(event) => patch({ channel: { ...channel, name: event.target.value } })}
              />
              <Input
                aria-label={t`Channel handle`}
                value={channel.handle}
                maxLength={40}
                disabled={paused}
                onChange={(event) => patch({ channel: { ...channel, handle: event.target.value } })}
              />
            </div>
          </details>
        </>
      )}
      {takeVariant ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t`Thumbnail takes`}>
          {takeVariant.takes.map((take, index) => {
            const n = i18n.number(index + 1);
            return (
              <Button
                key={take.assetId}
                size="sm"
                variant="secondary"
                disabled={paused}
                aria-pressed={cover.source.kind === 'asset' && cover.source.assetId === take.assetId}
                onClick={() => patch({ source: { kind: 'asset', assetId: take.assetId } })}
              >{t`Take ${n}`}</Button>
            );
          })}
        </div>
      ) : null}
      {conflict ? (
        <div className="flex flex-col gap-2">
          <p
            role="status"
            className="m-0 type-meta"
          >{t`The saved cover changed. Your design is still here.`}</p>
          <Button size="sm" variant="secondary" onClick={drafts.discard}>{t`Use updated cover`}</Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={paused || !command.can || !dirty}
          loading={command.busy === 'save-cover'}
          onClick={() => void save()}
        >
          {conflict ? t`Use my cover` : t`Save cover`}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={VERB_ICONS.export}
          disabled={paused || dirty || !saved || !actions.exportCover}
          title={dirty ? t`Save your cover first` : undefined}
          loading={exporting}
          onClick={() => void exportImage()}
        >{t`Export full-resolution JPEG`}</Button>
      </div>
      {command.error ? <MediaError error={command.error.error} /> : null}
      {exportError ? <MediaError error={exportError} /> : null}
    </section>
  );
}
