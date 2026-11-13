// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: take grid · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * up to four generated stills for one slot, side by side at 9:16 on the viewer grey, each with who made it (the
 *   provider's name and the model's id, as written); the one in the video carries the marigold ring and "In your
 *   video"; pressing another puts it in the slot
 * states: default · hover (the frame's edge lifts to ink-3) · focus-visible (base ring round the take) · active (1 px
 *   press) · disabled (no app actions, or the slot isn't in the video: the reason is the card's) · loading (the
 *   take going in: spinner over its frame, the others wait) · error (the card's line) · success (the ring moves)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { AssetId, CardOf } from '@taalcut/core';
import { Check, LoaderCircle } from 'lucide-react';
import { useId } from 'react';
import { ProviderLogo } from '#components/provider-logo';
import { cn } from '#lib/cn';
import { UserContent } from '../cards/card-frame';
import { providerLabel } from '../cards/labels';
import { ShotThumb } from '../make/shot-thumb';
import { useShotFrames } from '../make/use-shot-frames';
import { useMediaData } from './media-actions';

type Take = CardOf<'imageTakes'>['takes'][number];

export interface TakeGridProps {
  takes: readonly Take[];
  placed: AssetId | null;
  disabled: boolean;
  /** The take going in. */
  picking: AssetId | null;
  onPick: (take: Take) => void;
}

export function TakeGrid({ takes, placed, disabled, picking, onPick }: TakeGridProps) {
  const { t, i18n } = useLingui();
  const data = useMediaData();
  const frames = useShotFrames(takes.map((take) => ({ assetId: take.assetId, shotId: null })));
  const id = useId();
  return (
    <div className="@container">
      <ul data-slot="take-grid" className="m-0 grid list-none grid-cols-2 gap-3 p-0 @md:grid-cols-4">
        {takes.map((take, index) => {
          const inVideo = take.assetId === placed;
          const n = i18n.number(index + 1);
          const provider = providerLabel(i18n, take.provider);
          // Who made it is described by the lines under the take, as written (names and ids aren't translated).
          const byId = `${id}-by-${index}`;
          const modelId = `${id}-model-${index}`;
          const url =
            data.artifactUrl?.(take.thumbnailArtifactId) ??
            frames({ assetId: take.assetId, shotId: null })?.url;
          return (
            <li key={take.assetId} className="flex min-w-0 flex-col gap-1.5">
              <button
                type="button"
                data-slot="take"
                data-placed={inVideo || undefined}
                aria-pressed={inVideo}
                aria-label={t`Take ${n}`}
                aria-describedby={`${byId} ${modelId}`}
                disabled={disabled || inVideo || (picking !== null && picking !== take.assetId)}
                aria-busy={picking === take.assetId || undefined}
                onClick={() => onPick(take)}
                className={cn(
                  'group/take relative block w-full cursor-pointer rounded-md border border-transparent p-0.5 transition-[border-color,transform] duration-(--dur-micro) ease-(--ease-out)',
                  'hover:border-ink-3 active:translate-y-px disabled:cursor-default disabled:hover:border-transparent disabled:active:translate-y-0',
                  inVideo && 'cursor-default',
                )}
              >
                <ShotThumb
                  url={url}
                  size="lg"
                  selected={inVideo}
                  dimmed={picking !== null && picking !== take.assetId}
                  className="w-full"
                />
                {picking === take.assetId ? (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <LoaderCircle
                      aria-hidden
                      className="size-6 animate-spin text-viewer-rule motion-reduce:animate-[spin_2s_linear_infinite]"
                    />
                  </span>
                ) : null}
              </button>
              <div className="flex min-w-0 flex-col text-xs leading-tight">
                {inVideo ? (
                  <span className="flex items-center gap-1 font-semibold text-ink">
                    <Check aria-hidden className="size-3 shrink-0" />
                    {t`In your video`}
                  </span>
                ) : (
                  <span className="font-semibold text-ink-2">{t`Take ${n}`}</span>
                )}
                <span id={byId} className="inline-flex items-center gap-1 break-words text-ink-2">
                  <ProviderLogo provider={take.provider} size="xs" framed={false} />
                  <UserContent translate="no">{provider}</UserContent>
                </span>
                <span id={modelId} className="break-all text-ink-3">
                  <UserContent translate="no">{take.model}</UserContent>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
