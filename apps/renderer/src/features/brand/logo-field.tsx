// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: brand kit logo (P3-V10) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * the logo on the viewer grey with its size and type in words; Choose image… opens main's picker, the image is
 *   checked from its bytes (styles.importImage) and saved as one style.update; then its corner (four radios,
 *   arrow keys: the pointer-free equal of placing it), size, opacity and where it shows
 * states: default · no logo (Choose image… only) · hover/active/focus-visible (Buttons, Segmented, sliders) ·
 *   disabled (read-only) · loading (choosing or checking: Choose image… spins, keeps focus) · error (refused: the
 *   type, size or pixels in words, in a danger notice) · success (the new logo, Saved) · cancelled (nothing)
 * pre-emit critique: P4 H4 E4 S4 R5 V4
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, LOGO_LIMITS, STYLE_CORNERS, type Style, type StyleLogo } from '@taalcut/core';
import { Button, Segmented, StyleMark } from '@taalcut/ui';
import { ImageUp, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useMediaUrls } from '../../services/provider';
import { Notice } from '../settings/fields';
import { CORNER_LABELS, styleErrorMessage, type Corner } from './brand-words';
import { CommitRange } from './commit-fields';
import { logoUrl } from './use-styles';
import type { StyleEditor } from './use-style-editor';

/* eslint-disable lingui/no-unlocalized-strings -- file format names, the same in every language */
const TYPE_NAMES: Readonly<Record<StyleLogo['mediaType'], string>> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};
/* eslint-enable lingui/no-unlocalized-strings */

/** The corner picker: four radios (arrow keys move and pick), shared by the logo and the watermark. */
export function CornerPicker(props: {
  label: string;
  value: Corner;
  onChange: (corner: Corner) => void;
  disabled?: boolean;
}) {
  const { i18n } = useLingui();
  return (
    <Segmented
      className="self-start"
      label={props.label}
      value={props.value}
      disabled={props.disabled}
      options={STYLE_CORNERS.map((corner) => ({ value: corner, label: i18n._(CORNER_LABELS[corner]) }))}
      onChange={props.onChange}
    />
  );
}

export function LogoField({ editor, disabled }: { editor: StyleEditor; disabled?: boolean }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const media = useMediaUrls();
  const [choosing, setChoosing] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const style = editor.style;
  if (!style) return null;
  const logo = style.logo;
  const format = logo ? TYPE_NAMES[logo.mediaType] : '';
  const width = logo ? i18n.number(logo.width) : '';
  const height = logo ? i18n.number(logo.height) : '';
  const side = i18n.number(LOGO_LIMITS.pixels);
  const percent = (value: number) => i18n.number(value, { style: 'percent', maximumFractionDigits: 0 });
  const change = (part: Partial<StyleLogo>) =>
    void editor.commit('logo', (now) => (now.logo ? { logo: { ...now.logo, ...part } } : {}));

  const choose = async () => {
    setRefused(null);
    setChoosing(true);
    try {
      const picked = await callRpc(backend.files.pickFile({ purpose: 'brandImage' }));
      if (!picked.ok) return setRefused(styleErrorMessage(i18n, picked.error));
      if (!picked.value) return;
      const image = await callRpc(backend.styles.importImage({ path: picked.value.path }));
      if (!image.ok) return setRefused(styleErrorMessage(i18n, image.error));
      const { sha256: asset, mediaType, width, height } = image.value;
      await editor.commit('logo', (now: Style) => ({
        logo: {
          placement: 'topRight',
          scale: 0.14,
          opacity: 1,
          showOn: 'always',
          ...now.logo,
          asset,
          mediaType,
          width,
          height,
        },
      }));
    } finally {
      setChoosing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        {logo ? (
          <div className="flex size-20 items-center justify-center rounded-lg bg-viewer">
            <StyleMark name={style.name} colours={style.colours} logoUrl={logoUrl(media, logo)} />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {logo ? (
            <p className="m-0 type-body text-ink-2 tabular-nums">
              <Trans>
                <span translate="no">{format}</span>, {width} × {height} pixels
              </Trans>
            </p>
          ) : (
            <p className="m-0 type-body text-ink-2">{t`A PNG, JPEG or WebP image, up to ${side} pixels on a side.`}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={choosing} disabled={disabled} onClick={() => void choose()}>
              {choosing ? null : <ImageUp aria-hidden />}
              {logo ? t`Replace image…` : t`Choose image…`}
            </Button>
            {logo ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || choosing}
                onClick={() =>
                  void editor.commit('logo', (now) => ({
                    logo: null,
                    // A logo watermark needs the logo (styleProblems): it goes with it.
                    ...(now.watermark?.kind === 'logo' ? { watermark: null } : {}),
                  }))
                }
              >
                <Trash2 aria-hidden />
                {t`Remove logo`}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {refused ? (
        <Notice tone="danger" role="alert">
          {refused}
        </Notice>
      ) : null}
      {logo ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="type-label text-ink">{t`Corner`}</span>
            <CornerPicker
              label={t`Logo corner`}
              value={logo.placement}
              disabled={disabled}
              onChange={(placement) => change({ placement })}
            />
          </div>
          <CommitRange
            label={t`Size`}
            value={Math.round(logo.scale * 100)}
            min={5}
            max={40}
            step={1}
            disabled={disabled}
            words={(value) => {
              const share = percent(value / 100);
              return t`${share} of the width`;
            }}
            onCommit={(value) => change({ scale: value / 100 })}
          />
          <CommitRange
            label={t`Opacity`}
            value={Math.round(logo.opacity * 100)}
            min={20}
            max={100}
            step={5}
            disabled={disabled}
            words={(value) => percent(value / 100)}
            onCommit={(value) => change({ opacity: value / 100 })}
          />
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="type-label text-ink">{t`Show on`}</span>
            <Segmented
              className="self-start"
              label={t`Show the logo on`}
              value={logo.showOn}
              disabled={disabled}
              options={[
                { value: 'always', label: t`The whole video` },
                { value: 'introOutro', label: t`Intro and outro only` },
              ]}
              onChange={(showOn) => change({ showOn })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
