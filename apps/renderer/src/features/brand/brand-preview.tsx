// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: brand kit preview (P3-V10) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * a 9:16 frame on the viewer grey with the kit drawn on it in CSS (labelled "Preview": render draws the export):
 *   a title in the heading font on the kit's background, a caption line in the caption look with its highlighted
 *   word, the logo in its corner at its size and opacity, the watermark; Intro and Outro show the title cards
 * states: video · intro · outro (Segmented, eight states; a bumper that is None is disabled) · no captions (the
 *   line under the frame says videos keep theirs) · no logo · logo that won't load (its swatch) · reduced motion
 *   (nothing moves here)
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { useLingui } from '@lingui/react/macro';
import type { CaptionStyle, Style } from '@taalcut/core';
import { fontStack, Segmented, UserContent } from '@taalcut/ui';
import { Film } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useMediaUrls } from '../../services/provider';
import type { Corner } from './brand-words';
import { logoUrl } from './use-styles';

/** The preview's width in px (its skeleton draws the same box). */
export const PREVIEW_WIDTH = 224;
/** Render's canvas is 1080 wide: sizes in the Style are on it. */
const SCALE = PREVIEW_WIDTH / 1080;
const INSET = PREVIEW_WIDTH * 0.05;
type Mode = 'video' | 'intro' | 'outro';

const corner = (place: Corner): CSSProperties => ({
  position: 'absolute' as const,
  ...(place.startsWith('top') ? { top: INSET } : { bottom: INSET }),
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a corner's name in code, never shown
  ...(place.endsWith('Left') ? { left: INSET } : { right: INSET }),
});

const hexAlpha = (hex: string, alpha: number) =>
  `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;

function outline(width: number, colour: string): string {
  const w = Math.max(0.75, width);
  return [-w, w].flatMap((x) => [-w, w].map((y) => [`${x}px`, `${y}px`, '0', colour].join(' '))).join();
}

function Caption({ look, words }: { look: CaptionStyle; words: string }) {
  const parts = words.split(' ');
  const lit = Math.min(2, parts.length - 1);
  const css: CSSProperties = {
    fontFamily: fontStack(look.font),
    fontWeight: look.weight,
    fontSize: look.sizePx * SCALE,
    lineHeight: 1.15,
    color: look.textColor,
    textTransform: look.letterCase === 'upper' ? 'uppercase' : 'none',
    // The stroke as four hard shadows: how it reads at this size, and what contrast checkers can measure.
    ...(look.stroke ? { textShadow: outline(look.stroke.widthPx * SCALE, look.stroke.color) } : {}),
    ...(look.background
      ? {
          backgroundColor: hexAlpha(look.background.color, look.background.opacity),
          padding: look.background.paddingPx * SCALE,
          borderRadius: look.background.radiusPx * SCALE,
        }
      : {}),
  };
  return (
    <span
      className="absolute inset-x-3 flex -translate-y-1/2 justify-center text-center"
      style={{ top: `${look.anchorY * 100}%` }}
    >
      <span style={css}>
        {parts.map((word, index) => (
          <span key={index}>
            {index > 0 ? ' ' : null}
            <span
              style={
                index !== lit || look.highlight === 'none'
                  ? undefined
                  : look.highlight === 'box'
                    ? { backgroundColor: look.highlightColor, color: look.textColor, borderRadius: 2 }
                    : { color: look.highlightColor }
              }
            >
              {word}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** The logo at its corner, size and opacity; its swatch when it has no URL the page can load. */
function Logo({
  style,
  size,
  place,
  opacity,
}: {
  style: Style;
  size: number;
  place: Corner;
  opacity: number;
}) {
  const media = useMediaUrls();
  const [broken, setBroken] = useState(false);
  if (!style.logo) return null;
  const url = broken ? null : logoUrl(media, style.logo);
  const height = (size * style.logo.height) / style.logo.width;
  return (
    <span aria-hidden style={{ ...corner(place), width: size, height, opacity }}>
      {url ? (
        <img src={url} alt="" onError={() => setBroken(true)} className="size-full object-contain" />
      ) : (
        <span
          translate="no"
          className="flex size-full items-center justify-center rounded-sm font-semibold"
          style={{
            backgroundColor: style.colours.primary,
            color: style.colours.background,
            fontSize: height * 0.5,
          }}
        >
          {[...style.name.trim()][0]?.toUpperCase() ?? ''}
        </span>
      )}
    </span>
  );
}

export function BrandPreview({ style, opensOn = 'video' }: { style: Style; opensOn?: Mode }) {
  const { t } = useLingui();
  // Where it opens: the editor's Intro and outro view opens it on the intro (the layout remounts it per view).
  const [mode, setMode] = useState<Mode>(opensOn);
  const shown: Mode = mode !== 'video' && !style[mode] ? 'video' : mode;
  const bumper = shown === 'video' ? null : style[shown];
  const heading: CSSProperties = {
    fontFamily: fontStack(style.fonts.heading.family),
    fontWeight: style.fonts.heading.weight,
    color: style.colours.text,
  };
  const mark = style.watermark;
  const logoSize = (style.logo?.scale ?? 0) * PREVIEW_WIDTH;
  const logoOnVideo = style.logo?.showOn === 'always';
  let frame: ReactNode;
  if (bumper?.kind === 'card') {
    frame = (
      <span
        className="absolute inset-0 flex items-center justify-center p-5 text-center text-xl"
        style={{ ...heading, backgroundColor: style.colours[bumper.background] }}
      >
        <UserContent>{bumper.text}</UserContent>
      </span>
    );
  } else if (bumper?.kind === 'clip') {
    frame = (
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center text-sm text-ink-2">
        <Film aria-hidden className="size-5" />
        {t`A clip from your library`}
      </span>
    );
  } else {
    frame = (
      <>
        <span
          className="absolute inset-x-4 top-[22%] rounded-md px-3 py-2 text-center text-lg"
          style={{ ...heading, backgroundColor: hexAlpha(style.colours.background, 0.9) }}
        >
          {t`Morning at the stall`}
        </span>
        {style.captions ? <Caption look={style.captions} words={t`Chai for forty rupees`} /> : null}
        {mark?.kind === 'text' ? (
          <span
            className="text-xs"
            style={{ ...corner(mark.placement), opacity: mark.opacity, color: style.colours.text }}
          >
            <UserContent>{mark.text}</UserContent>
          </span>
        ) : null}
        {mark?.kind === 'logo' && style.logo ? (
          <Logo style={style} size={logoSize * 0.6} place={mark.placement} opacity={mark.opacity} />
        ) : null}
      </>
    );
  }
  return (
    <figure className="m-0 flex flex-col items-center gap-3" aria-label={t`Preview of the brand kit`}>
      <div
        data-slot="brand-preview"
        className="relative aspect-[9/16] overflow-hidden rounded-lg bg-viewer"
        style={{ width: PREVIEW_WIDTH }}
      >
        {frame}
        {style.logo && (shown !== 'video' || logoOnVideo) ? (
          <Logo style={style} size={logoSize} place={style.logo.placement} opacity={style.logo.opacity} />
        ) : null}
      </div>
      <Segmented<Mode>
        label={t`Preview`}
        value={shown}
        options={[
          { value: 'intro', label: t`Intro`, disabled: !style.intro },
          { value: 'video', label: t`Video` },
          { value: 'outro', label: t`Outro`, disabled: !style.outro },
        ]}
        onChange={setMode}
      />
      <figcaption className="max-w-56 text-center type-meta text-ink-3">
        {style.captions
          ? t`Preview. The export draws it exactly.`
          : t`Preview. Captions keep each video’s own look.`}
      </figcaption>
    </figure>
  );
}
