// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: publish-thumbnail-studio · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.7 · multi-aspect Hallmark thumbnail studio with live archetype/theme switching,
 *   safe-zone + IG 4:5 profile grid crop guides, channel branding bar, and YouTube / Shorts feed squint preview.
 * pre-emit critique: P5 H5 E5 S5 R5 V5 */

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { AssetId, CardOf, ThumbnailArchetype, ThumbnailAspect, ThumbnailTheme } from '@taalcut/core';
import { Check, Eye, ImagePlus, LayoutGrid, User } from 'lucide-react';
import { useState } from 'react';
import { Button } from '#components/button';
import { Input } from '#components/input';
import { ProviderLogo } from '#components/provider-logo';
import { cn } from '#lib/cn';
import { useShotFrames } from '../make/use-shot-frames';
import { useMediaData } from '../media/media-actions';
import { FollowUpLine } from '../media/media-lines';
import type { FollowUp } from '../media/use-command';
import { UserContent } from './card-frame';
import { providerLabel } from './labels';
import { FeedPreviewStage, THEME_STYLES, ThumbnailSurface } from './publish-thumbnail-canvas';

type Card = CardOf<'publishPack'>;

const ASPECT_LABELS: Readonly<Record<ThumbnailAspect, MessageDescriptor>> = {
  '16:9': msg`16:9 YouTube`,
  '9:16': msg`9:16 Shorts & Reels`,
  '4:5': msg`4:5 IG Feed`,
  '1:1': msg`1:1 IG Grid`,
};

const ARCHETYPE_LABELS: Readonly<Record<ThumbnailArchetype, MessageDescriptor>> = {
  'editorial-specimen': msg`Editorial`,
  'brutal-slab': msg`Brutal`,
  'atmospheric-cinema': msg`Atmospheric`,
  'minimal-frame': msg`Minimal`,
  'stat-callout': msg`Stat`,
};

const THEME_LABELS: Readonly<Record<ThumbnailTheme, MessageDescriptor>> = {
  'golden-hour': msg`Golden hour`,
  midnight: msg`Midnight`,
  newsprint: msg`Newsprint`,
  studio: msg`Studio`,
  terminal: msg`Terminal`,
  'brand-kit': msg`Brand`,
};

export interface PublishThumbnailStudioProps {
  readonly card: Card;
  readonly selectedYtTitle: string;
  readonly followUp: FollowUp;
}

export function PreviewThumbnailStudio({ card, selectedYtTitle, followUp }: PublishThumbnailStudioProps) {
  const { t, i18n } = useLingui();
  const data = useMediaData();

  const firstVariant = card.thumbnails[0]!;
  const [activeAspect, setActiveAspect] = useState<ThumbnailAspect>(firstVariant.aspect);
  const matchedVariant = card.thumbnails.find((v) => v.aspect === activeAspect) ?? firstVariant;

  const [archetypeOverrides, setArchetypeOverrides] = useState<
    Partial<Record<ThumbnailAspect, ThumbnailArchetype>>
  >({});
  const [themeOverrides, setThemeOverrides] = useState<Partial<Record<ThumbnailAspect, ThumbnailTheme>>>({});
  const [takeOverrides, setTakeOverrides] = useState<Partial<Record<ThumbnailAspect, AssetId>>>({});
  const [viewMode, setViewMode] = useState<'canvas' | 'feed'>('canvas');
  const [showSafeZones, setShowSafeZones] = useState(false);

  const [showChannelOnThumb, setShowChannelOnThumb] = useState<boolean>(
    card.channel?.showOnThumbnail ?? Boolean(card.channel?.name || card.channel?.handle),
  );
  const [channelName, setChannelName] = useState<string>(card.channel?.name ?? '');
  const [channelHandle, setChannelHandle] = useState<string>(card.channel?.handle ?? '');

  const activeArchetype = archetypeOverrides[activeAspect] ?? matchedVariant.archetype;
  const activeTheme = themeOverrides[activeAspect] ?? matchedVariant.theme;
  const selectedAssetId = takeOverrides[activeAspect] ?? matchedVariant.selectedAssetId;
  const selectedTake =
    matchedVariant.takes.find((take) => take.assetId === selectedAssetId) ?? matchedVariant.takes[0]!;

  const frames = useShotFrames(matchedVariant.takes.map((take) => ({ assetId: take.assetId, shotId: null })));
  const backdropUrl =
    data.artifactUrl?.(selectedTake.thumbnailArtifactId) ??
    frames({ assetId: selectedTake.assetId, shotId: null })?.url ??
    null;
  const avatarUrl = card.channel?.avatarArtifactId
    ? (data.artifactUrl?.(card.channel.avatarArtifactId) ?? null)
    : null;

  const themeStyle = THEME_STYLES[activeTheme];
  const durationBadge = matchedVariant.durationBadge ?? '';
  const hookText = matchedVariant.hookText;
  const normalizedHandle = channelHandle.trim()
    ? channelHandle.trim().startsWith('@')
      ? channelHandle.trim()
      : `@${channelHandle.trim()}`
    : '';

  return (
    <section aria-label={t`Thumbnail studio`} data-slot="thumbnail-studio" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label={t`Aspect ratio`}
          data-slot="aspect-switcher"
          className="flex flex-wrap items-center gap-1"
        >
          {(Object.keys(ASPECT_LABELS) as ThumbnailAspect[]).map((aspect) => {
            const active = aspect === activeAspect;
            const hasDedicated = card.thumbnails.some((v) => v.aspect === aspect);
            return (
              <button
                key={aspect}
                type="button"
                aria-pressed={active}
                data-aspect-pill={aspect}
                onClick={() => setActiveAspect(aspect)}
                className={cn(
                  'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 type-label-sm transition-colors duration-(--dur-micro) ease-(--ease-out)',
                  active
                    ? 'border-rule-strong bg-inverse text-on-inverse'
                    : 'border-rule bg-control text-ink-2 hover:bg-control-hover hover:text-ink',
                )}
              >
                <span>{i18n._(ASPECT_LABELS[aspect])}</span>
                {hasDedicated ? <span aria-hidden className="size-1.5 rounded-pill bg-primary" /> : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div
            role="group"
            aria-label={t`Preview mode`}
            data-slot="view-mode-switcher"
            className="inline-flex items-center rounded-pill border border-rule bg-sunken p-0.5"
          >
            <button
              type="button"
              aria-pressed={viewMode === 'canvas'}
              onClick={() => setViewMode('canvas')}
              className={cn(
                'inline-flex h-6 cursor-pointer items-center gap-1 rounded-pill px-2.5 type-label-sm transition-colors duration-(--dur-micro) ease-(--ease-out)',
                viewMode === 'canvas' ? 'bg-raised text-ink shadow-2xs' : 'text-ink-2 hover:text-ink',
              )}
            >
              <LayoutGrid aria-hidden className="size-3.5" />
              {t`Canvas`}
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'feed'}
              onClick={() => setViewMode('feed')}
              className={cn(
                'inline-flex h-6 cursor-pointer items-center gap-1 rounded-pill px-2.5 type-label-sm transition-colors duration-(--dur-micro) ease-(--ease-out)',
                viewMode === 'feed' ? 'bg-raised text-ink shadow-2xs' : 'text-ink-2 hover:text-ink',
              )}
            >
              <Eye aria-hidden className="size-3.5" />
              {t`Feed preview`}
            </button>
          </div>

          <button
            type="button"
            data-slot="safe-zones-toggle"
            aria-pressed={showSafeZones}
            onClick={() => setShowSafeZones((prev) => !prev)}
            className={cn(
              'inline-flex h-7 cursor-pointer items-center gap-1 rounded-pill border px-2.5 type-label-sm transition-colors duration-(--dur-micro) ease-(--ease-out)',
              showSafeZones
                ? 'border-rule-strong bg-primary-soft text-primary-strong'
                : 'border-rule bg-control text-ink-2 hover:bg-control-hover hover:text-ink',
            )}
          >
            {t`Safe zones`}
          </button>
        </div>
      </div>

      {viewMode === 'canvas' ? (
        <div className="rounded-xl border border-rule bg-sunken p-3">
          <ThumbnailSurface
            variant={matchedVariant}
            aspect={activeAspect}
            archetype={activeArchetype}
            theme={activeTheme}
            themeStyle={themeStyle}
            backdropUrl={backdropUrl}
            showChannelOnThumb={showChannelOnThumb}
            channelName={channelName}
            channelHandle={normalizedHandle}
            avatarUrl={avatarUrl}
            showSafeZones={showSafeZones}
            durationBadge={durationBadge}
          />
        </div>
      ) : (
        <FeedPreviewStage
          variant={matchedVariant}
          aspect={activeAspect}
          archetype={activeArchetype}
          theme={activeTheme}
          themeStyle={themeStyle}
          backdropUrl={backdropUrl}
          showChannelOnThumb={showChannelOnThumb}
          channelName={channelName}
          channelHandle={normalizedHandle}
          avatarUrl={avatarUrl}
          durationBadge={durationBadge}
          selectedYtTitle={selectedYtTitle}
          igHook={card.social.instagram.hookLine}
        />
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-rule-subtle bg-sunken p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1" data-slot="archetype-switcher">
            <span className="pe-1 type-meta font-medium text-ink-2">{t`Archetype`}</span>
            {(Object.keys(ARCHETYPE_LABELS) as ThumbnailArchetype[]).map((arch) => {
              const active = arch === activeArchetype;
              return (
                <button
                  key={arch}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setArchetypeOverrides((prev) => ({ ...prev, [activeAspect]: arch }))}
                  className={cn(
                    'inline-flex h-6 cursor-pointer items-center rounded-pill border px-2 type-caption transition-colors duration-(--dur-micro) ease-(--ease-out)',
                    active
                      ? 'border-rule-strong bg-raised text-ink font-semibold'
                      : 'border-transparent bg-chip text-ink-2 hover:bg-hover hover:text-ink',
                  )}
                >
                  {i18n._(ARCHETYPE_LABELS[arch])}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1" data-slot="theme-switcher">
          <span className="pe-1 type-meta font-medium text-ink-2">{t`Palette`}</span>
          {(Object.keys(THEME_LABELS) as ThumbnailTheme[]).map((th) => {
            const active = th === activeTheme;
            return (
              <button
                key={th}
                type="button"
                aria-pressed={active}
                onClick={() => setThemeOverrides((prev) => ({ ...prev, [activeAspect]: th }))}
                className={cn(
                  'inline-flex h-6 cursor-pointer items-center rounded-pill border px-2 type-caption transition-colors duration-(--dur-micro) ease-(--ease-out)',
                  active
                    ? 'border-rule-strong bg-raised text-ink font-semibold'
                    : 'border-transparent bg-chip text-ink-2 hover:bg-hover hover:text-ink',
                )}
              >
                {i18n._(THEME_LABELS[th])}
              </button>
            );
          })}
        </div>
      </div>

      <div
        data-slot="channel-branding-bar"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-rule-subtle bg-sunken p-2.5"
      >
        <button
          type="button"
          data-slot="channel-badge-toggle"
          aria-pressed={showChannelOnThumb}
          onClick={() => setShowChannelOnThumb((prev) => !prev)}
          className={cn(
            'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 type-label-sm transition-colors duration-(--dur-micro) ease-(--ease-out)',
            showChannelOnThumb
              ? 'border-rule-strong bg-inverse text-on-inverse'
              : 'border-rule bg-raised text-ink-2 hover:text-ink',
          )}
        >
          <User aria-hidden className="size-3.5" />
          {t`Channel badge`}
        </button>
        <div className="flex min-w-48 flex-1 items-center gap-2">
          <Input
            aria-label={t`Channel name`}
            placeholder={t`Channel name`}
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            className="h-8 type-label-sm"
          />
          <Input
            aria-label={t`Channel handle`}
            placeholder={t`@handle`}
            value={channelHandle}
            onChange={(e) => setChannelHandle(e.target.value)}
            className="h-8 type-label-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t`Thumbnail takes`}>
          {matchedVariant.takes.map((take, index) => {
            const isSelected = take.assetId === selectedTake.assetId;
            const n = i18n.number(index + 1);
            const provider = providerLabel(i18n, take.provider);
            return (
              <button
                key={take.assetId}
                type="button"
                data-slot="thumbnail-take"
                aria-pressed={isSelected}
                aria-label={t`Take ${n}`}
                onClick={() => setTakeOverrides((prev) => ({ ...prev, [activeAspect]: take.assetId }))}
                className={cn(
                  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 type-label-sm transition-colors duration-(--dur-micro) ease-(--ease-out)',
                  isSelected
                    ? 'border-primary-strong bg-primary-soft text-ink font-semibold'
                    : 'border-rule bg-raised text-ink-2 hover:bg-hover hover:text-ink',
                )}
              >
                {isSelected ? <Check aria-hidden className="size-3.5 text-primary-strong" /> : null}
                <span>{t`Take ${n}`}</span>
                <ProviderLogo provider={take.provider} size="xs" framed={false} />
                <span className="type-caption text-ink-2">
                  <UserContent translate="no">{provider}</UserContent>
                </span>
              </button>
            );
          })}
        </div>

        {followUp.can ? (
          <Button
            size="sm"
            variant="secondary"
            icon={ImagePlus}
            loading={followUp.busy === 'more-thumb'}
            onClick={() =>
              void followUp.send(
                'more-thumb',
                t`Make another ${activeAspect} thumbnail take for "${hookText}".`,
              )
            }
          >
            {t`Make another take`}
          </Button>
        ) : null}
      </div>
      <FollowUpLine followUp={followUp} />
    </section>
  );
}
