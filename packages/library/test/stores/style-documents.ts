// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Style v1 documents and a format template for the Phase 3 store tests (after core's phase3 helpers). */
import {
  FrameRates,
  newId,
  RationalTime,
  STYLE_SCHEMA_VERSION,
  type FormatId,
  type Style,
  type Template,
  type TemplateId,
} from '@taalcut/core';
import { T0, template } from './documents';

export interface StyleOptions {
  readonly name?: string;
  /** The logo's asset; null for none. */
  readonly logo?: string | null;
  readonly revision?: number;
  readonly updatedAt?: number;
  readonly madeFrom?: { readonly templateId: TemplateId; readonly version: number } | null;
}

export function style(options: StyleOptions = {}): Style {
  const heading = { family: 'poppins' as const, weight: 700 };
  const logo = options.logo === undefined ? null : options.logo;
  return {
    schemaVersion: STYLE_SCHEMA_VERSION,
    id: newId<'Style'>(),
    revision: options.revision ?? 1,
    name: options.name ?? 'Goa kit',
    kind: options.madeFrom ? 'look' : 'brandKit',
    colours: {
      primary: '#112233',
      secondary: '#445566',
      accent: '#ff8800',
      text: '#ffffff',
      background: '#000000',
    },
    fonts: { heading, body: { family: 'notoSans', weight: 400 } },
    captions: null,
    textStyles: { title: { font: heading, colour: '#ffffff', background: null, stroke: null } },
    logo: logo
      ? {
          asset: logo,
          mediaType: 'image/png',
          width: 512,
          height: 512,
          placement: 'topRight',
          scale: 0.12,
          opacity: 0.9,
          showOn: 'always',
        }
      : null,
    watermark: null,
    intro: {
      kind: 'card',
      text: 'Goa',
      duration: RationalTime.of(60, FrameRates.fps30),
      background: 'primary',
    },
    outro: null,
    grade: null,
    fontMatch: null,
    madeFrom: options.madeFrom ?? null,
    createdAt: T0,
    updatedAt: options.updatedAt ?? T0,
  };
}

/** A format plan (a vlog by default) in `language`, naming `styleId`. */
export function formatTemplate(
  options: {
    readonly formatId?: FormatId;
    readonly language?: string | null;
    readonly styleId?: Style['id'];
  } = {},
): Template {
  const base = template();
  return {
    ...base,
    origin: {
      kind: 'format',
      formatId: options.formatId ?? 'vlog',
      formatVersion: '1',
      target: base.duration,
      brief: 'a 3 s vlog of my Goa trip',
    },
    language: options.language === undefined ? 'hi' : options.language,
    styleId: options.styleId ?? null,
  };
}
