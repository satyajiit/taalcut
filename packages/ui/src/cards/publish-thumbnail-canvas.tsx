// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: publish-thumbnail-canvas · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.7 · the Hallmark-styled thumbnail canvas surface, safe-zone + IG 4:5 profile grid
 *   crop guides, and YouTube / Shorts feed squint-test preview stage.
 */

import { Trans, useLingui } from '@lingui/react/macro';
import type { ThumbnailArchetype, ThumbnailAspect, ThumbnailTheme, ThumbnailVariant } from '@taalcut/core';
import { Badge } from '#components/badge';
import { cn } from '#lib/cn';
import { UserContent } from './card-frame';
import { thumbnailLayout } from './publish-thumbnail-layout';

export const THEME_STYLES: Readonly<
  Record<
    ThumbnailTheme,
    {
      readonly surface: string;
      readonly kicker: string;
      readonly stat: string;
      readonly headline: string;
      readonly badge: string;
    }
  >
> = {
  'golden-hour': {
    surface: cn('bg-viewer text-viewer-ink border-viewer-rule'),
    kicker: cn('bg-marigold text-marigold-ink'),
    stat: cn('bg-marigold-soft text-marigold-strong border-rule'),
    headline: cn('text-viewer-ink'),
    badge: cn('bg-sunken text-ink border-rule'),
  },
  midnight: {
    surface: cn('bg-inverse text-on-inverse border-rule-strong'),
    kicker: cn('bg-violet text-violet-ink'),
    stat: cn('bg-violet-soft text-violet-strong border-rule'),
    headline: cn('text-on-inverse'),
    badge: cn('bg-panel text-ink border-rule'),
  },
  newsprint: {
    surface: cn('bg-canvas text-ink border-rule-strong'),
    kicker: cn('bg-inverse text-on-inverse'),
    stat: cn('bg-sunken text-ink border-rule-strong'),
    headline: cn('text-ink'),
    badge: cn('bg-raised text-ink border-rule-strong'),
  },
  studio: {
    surface: cn('bg-raised text-ink border-rule'),
    kicker: cn('bg-coral text-coral-ink'),
    stat: cn('bg-coral-soft text-coral-strong border-rule'),
    headline: cn('text-ink'),
    badge: cn('bg-sunken text-ink border-rule'),
  },
  terminal: {
    surface: cn('bg-viewer text-viewer-ink border-viewer-rule font-mono'),
    kicker: cn('bg-teal text-teal-ink font-mono'),
    stat: cn('bg-teal-soft text-teal-strong border-rule font-mono'),
    headline: cn('text-viewer-ink font-mono'),
    badge: cn('bg-sunken text-ink border-rule font-mono'),
  },
  'brand-kit': {
    surface: cn('bg-panel text-ink border-rule-strong'),
    kicker: cn('bg-rose text-rose-ink'),
    stat: cn('bg-rose-soft text-rose-strong border-rule'),
    headline: cn('text-ink'),
    badge: cn('bg-raised text-ink border-rule'),
  },
};

const ASPECT_BOX: Readonly<Record<ThumbnailAspect, string>> = {
  '16:9': cn('aspect-video w-full'),
  '9:16': cn('aspect-[9/16] w-full max-w-60 mx-auto'),
  '4:5': cn('aspect-[4/5] w-full max-w-68 mx-auto'),
  '1:1': cn('aspect-square w-full max-w-68 mx-auto'),
};

export interface ThumbnailSurfaceProps {
  readonly variant: ThumbnailVariant;
  readonly aspect: ThumbnailAspect;
  readonly archetype: ThumbnailArchetype;
  readonly theme: ThumbnailTheme;
  readonly themeStyle: (typeof THEME_STYLES)[ThumbnailTheme];
  readonly backdropUrl: string | null;
  readonly showChannelOnThumb: boolean;
  readonly channelName: string;
  readonly channelHandle: string;
  readonly avatarUrl: string | null;
  readonly showSafeZones: boolean;
  readonly durationBadge: string;
  readonly compact?: boolean;
}

export function ThumbnailSurface({
  variant,
  aspect,
  archetype,
  theme,
  themeStyle,
  backdropUrl,
  showChannelOnThumb,
  channelName,
  channelHandle,
  showSafeZones,
  durationBadge,
  compact = false,
}: ThumbnailSurfaceProps) {
  const { t } = useLingui();
  const layout = thumbnailLayout(variant, aspect, archetype, theme);
  const callout = archetype === 'stat-callout';
  const channel = showChannelOnThumb
    ? [channelName.trim(), channelHandle.trim()].filter(Boolean).join(' · ')
    : '';

  return (
    <div
      data-slot="thumbnail-canvas"
      data-aspect={aspect}
      data-archetype={archetype}
      data-theme={theme}
      style={layout.root}
      className={cn(
        'relative overflow-hidden rounded-lg border select-none',
        compact ? (aspect === '16:9' ? 'w-full' : 'w-44') : ASPECT_BOX[aspect],
        themeStyle.surface,
      )}
    >
      {backdropUrl ? (
        <img src={backdropUrl} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
      {variant.composition !== 'complete' && (variant.hookText || variant.statBadge || channel) ? (
        <div aria-hidden className="absolute inset-0" style={layout.scrim} />
      ) : null}
      {variant.composition !== 'complete' ? (
        <div data-slot="thumbnail-safe-content" className="absolute flex flex-col" style={layout.safe}>
          {channel || (!callout && variant.statBadge) ? (
            <div className="flex items-start justify-between" style={layout.badges}>
              {channel ? (
                <div data-slot="thumbnail-channel-badge" style={layout.channel}>
                  <UserContent translate="no">{channel}</UserContent>
                </div>
              ) : null}
              {!callout && variant.statBadge ? (
                <div data-slot="thumbnail-stat-badge" style={layout.stat}>
                  <UserContent translate="no">{variant.statBadge}</UserContent>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col" style={layout.body}>
            <div data-slot="thumbnail-words" style={layout.words}>
              {callout && variant.statBadge ? (
                <div data-slot="thumbnail-stat-badge" style={layout.callout}>
                  <UserContent translate="no">{variant.statBadge}</UserContent>
                </div>
              ) : null}
              {variant.kickerText ? (
                <div data-slot="thumbnail-kicker" style={layout.kicker}>
                  <UserContent translate="no">{variant.kickerText}</UserContent>
                </div>
              ) : null}
              <p data-slot="thumbnail-hook" style={layout.hook}>
                <UserContent translate="no">{variant.hookText}</UserContent>
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {showSafeZones ? (
        <div
          data-slot="safe-zones-overlay"
          className="pointer-events-none absolute inset-0 flex flex-col justify-between"
        >
          {aspect === '16:9' ? (
            <div className="mt-auto ms-auto m-2 rounded-sm border border-dashed border-warning-strong bg-warning-soft px-2 py-0.5 type-caption font-mono text-warning-strong">
              <Trans>
                Duration zone (<UserContent translate="no">{durationBadge}</UserContent>)
              </Trans>
            </div>
          ) : aspect === '9:16' ? (
            <>
              <div
                data-slot="ig-grid-crop-guide"
                className="pointer-events-none absolute inset-x-2 top-[21.875%] bottom-[21.875%] flex items-start justify-start rounded-md border-2 border-dashed border-primary p-1.5"
              >
                <Badge tone="primary">{t`4:5 & 1:1 profile grid crop`}</Badge>
              </div>
              <div className="ms-auto mt-auto mb-12 me-1.5 flex h-28 w-10 items-center justify-center rounded-md border border-dashed border-warning-strong bg-warning-soft p-1 text-center type-caption text-warning-strong">
                {t`Actions`}
              </div>
              <div className="inset-x-2 bottom-1.5 mx-2 mb-1.5 rounded-sm border border-dashed border-warning-strong bg-warning-soft px-2 py-0.5 type-caption text-warning-strong">
                {t`Caption safe zone`}
              </div>
            </>
          ) : (
            <div
              data-slot="ig-grid-crop-guide"
              className={cn(
                'pointer-events-none absolute inset-x-[7%] flex items-start justify-start rounded-md border-2 border-dashed border-primary p-1.5',
                aspect === '4:5' ? 'inset-y-[10%]' : 'inset-y-[8%]',
              )}
            >
              <Badge tone="primary">{t`Profile grid safe zone`}</Badge>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function FeedPreviewStage({
  variant,
  aspect,
  archetype,
  theme,
  themeStyle,
  backdropUrl,
  showChannelOnThumb,
  channelName,
  channelHandle,
  avatarUrl,
  durationBadge,
  selectedYtTitle,
  igHook,
}: Omit<ThumbnailSurfaceProps, 'showSafeZones' | 'compact'> & {
  readonly selectedYtTitle: string;
  readonly igHook: string;
}) {
  const { t } = useLingui();
  const isYoutube = aspect === '16:9';

  return (
    <div
      data-slot="feed-preview"
      data-feed-type={isYoutube ? 'youtube' : 'shorts-reels'}
      className="flex flex-col gap-2 rounded-xl border border-rule bg-sunken p-3"
    >
      <div className="flex items-center justify-between">
        <span className="type-meta font-medium text-ink-2">
          {isYoutube ? t`YouTube Home feed preview` : t`Shorts & Reels shelf preview`}
        </span>
        <Badge tone="neutral">
          <UserContent translate="no">{aspect}</UserContent>
        </Badge>
      </div>

      {isYoutube ? (
        <div className="mx-auto flex w-full max-w-sm flex-col gap-2.5 rounded-lg border border-rule bg-raised p-2.5">
          <div className="relative">
            <ThumbnailSurface
              variant={variant}
              aspect="16:9"
              archetype={archetype}
              theme={theme}
              themeStyle={themeStyle}
              backdropUrl={backdropUrl}
              showChannelOnThumb={showChannelOnThumb}
              channelName={channelName}
              channelHandle={channelHandle}
              avatarUrl={avatarUrl}
              showSafeZones={false}
              durationBadge={durationBadge}
              compact
            />
            <span className="absolute end-2 bottom-2 rounded-sm bg-inverse px-1.5 py-0.5 font-mono type-caption text-on-inverse tabular-nums">
              <UserContent translate="no">{durationBadge}</UserContent>
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-pill bg-primary text-primary-ink type-label-sm font-bold"
            >
              {(channelName.trim()[0] ?? 'T').toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p data-slot="feed-preview-title" className="m-0 line-clamp-2 type-label text-ink">
                <UserContent translate="no">{selectedYtTitle}</UserContent>
              </p>
              <p className="m-0 type-meta text-ink-2">
                <UserContent translate="no">{channelName.trim() || t`Channel`}</UserContent>
                {channelHandle ? (
                  <>
                    <span aria-hidden>{' · '}</span>
                    <UserContent translate="no">{channelHandle}</UserContent>
                  </>
                ) : null}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto flex items-start gap-3 rounded-lg border border-rule bg-raised p-3">
          <ThumbnailSurface
            variant={variant}
            aspect={aspect}
            archetype={archetype}
            theme={theme}
            themeStyle={themeStyle}
            backdropUrl={backdropUrl}
            showChannelOnThumb={showChannelOnThumb}
            channelName={channelName}
            channelHandle={channelHandle}
            avatarUrl={avatarUrl}
            showSafeZones={false}
            durationBadge={durationBadge}
            compact
          />
          <div className="flex max-w-52 flex-col gap-1.5 pt-1">
            <Badge tone="primary">{t`Shelf squint check`}</Badge>
            <p data-slot="feed-preview-title" className="m-0 type-label text-ink">
              <UserContent translate="no">{igHook || selectedYtTitle}</UserContent>
            </p>
            <p className="m-0 type-meta text-ink-2">
              <UserContent translate="no">{channelName.trim() || t`Channel`}</UserContent>
              {channelHandle ? (
                <>
                  <span aria-hidden>{' · '}</span>
                  <UserContent translate="no">{channelHandle}</UserContent>
                </>
              ) : null}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
