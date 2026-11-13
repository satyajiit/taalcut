// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** toHubTemplate drops everything that must stay on this Mac (D9). */
import { describe, expect, it } from 'vitest';
import { newId, styleSchema, type Style } from '@taalcut/core';
import { toHubTemplate } from '../../src/hub/to-hub';
import { SHA, T0, referenceTemplate } from '../helpers/fixtures';
import { FORM, meta } from './helpers';

const BANNED_KEYS = new Set([
  'contactSheet',
  'fingerprint',
  'frame',
  'waveform',
  'url',
  'sound',
  'frames',
  'approved',
  'cut',
  'slotId',
]);

const PRIVATE_TEXT = ['Goa', 'Follow for more', 'Original audio', 'https://www.instagram.com/reel/abc', SHA];

function walk(value: unknown, path: string, bannedKeys: ReadonlySet<string>): void {
  if (typeof value === 'string') {
    for (const secret of PRIVATE_TEXT) {
      expect(value.includes(secret), `${path} contains ${secret}`).toBe(false);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, bannedKeys));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      expect(bannedKeys.has(key), `${path}.${key}`).toBe(false);
      walk(item, `${path}.${key}`, bannedKeys);
    }
  }
}

function look(): Style {
  const heading = { family: 'poppins' as const, weight: 700 };
  return styleSchema.parse({
    schemaVersion: 1,
    id: newId<'Style'>(),
    revision: 1,
    name: 'Goa kit',
    kind: 'brandKit',
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
    logo: {
      asset: SHA,
      mediaType: 'image/png',
      width: 512,
      height: 512,
      placement: 'topRight',
      scale: 0.12,
      opacity: 0.9,
      showOn: 'always',
    },
    watermark: { kind: 'text', text: 'SECRET MARK', placement: 'bottomRight', opacity: 0.3 },
    intro: { kind: 'card', text: 'Goa', seconds: 2, background: 'primary' },
    outro: null,
    grade: null,
    fontMatch: null,
    madeFrom: null,
    createdAt: T0,
    updatedAt: T0,
  });
}

describe('toHubTemplate', () => {
  it('copies structure and drops the reference words, link, sound, frames and sheet', () => {
    const template = referenceTemplate();
    const card = meta();
    const built = toHubTemplate(template, card, FORM, null);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const doc = built.value;
    walk(doc, '$', BANNED_KEYS);
    expect(doc).toMatchObject({
      format: 'taalcut.template',
      formatVersion: 0,
      licence: 'CC0-1.0',
      id: card.hubId,
      version: 1,
      name: FORM.name,
      handle: FORM.handle,
      forkedFrom: null,
      style: null,
      trendFreshness: null,
      formatId: null,
    });
    expect(doc.structure.slots.map((slot) => slot.role)).toEqual(template.slots.map((slot) => slot.role));
    expect(doc.structure.slots.map((slot) => slot.duration)).toEqual(
      template.slots.map((slot) => slot.duration),
    );
    expect('source' in doc.structure.slots[0]!.intent).toBe(false);
    expect('id' in doc.structure.slots[0]!).toBe(false);
    expect(doc.structure.audio).toEqual({
      kind: 'music',
      loudnessLufs: -14,
      speechCoverage: null,
      speechLanguage: null,
    });
    expect(doc.structure.beatMap?.beats).toHaveLength(8);
    expect(doc.structure.text).toEqual([
      expect.objectContaining({ slotIndex: 1, placeholder: '{title}', words: 1, chars: 3 }),
      expect.objectContaining({ slotIndex: 3, placeholder: '{title}', words: 3, chars: 15 }),
    ]);
  });

  it('attaches colours, fonts, captions and text styles only when asked', () => {
    const style = look();
    const withStyle = toHubTemplate(referenceTemplate(), meta(), { ...FORM, includeStyle: true }, style);
    expect(withStyle.ok).toBe(true);
    if (!withStyle.ok) return;
    expect(withStyle.value.style).toEqual({
      colours: style.colours,
      fonts: style.fonts,
      captions: style.captions,
      textStyles: style.textStyles,
    });
    walk(withStyle.value, '$', new Set([...BANNED_KEYS, 'logo', 'watermark', 'intro', 'outro']));
    expect(JSON.stringify(withStyle.value).includes('SECRET MARK')).toBe(false);

    const skipped = toHubTemplate(referenceTemplate(), meta(), { ...FORM, includeStyle: false }, style);
    expect(skipped.ok && skipped.value.style).toBeNull();
  });

  it('builds each part from the hub fields, so a key Template or Style gains later stays on this Mac', () => {
    const template = referenceTemplate();
    const widened = {
      ...template,
      canvas: Object.assign({ colourSpace: 'p3' }, template.canvas),
      pacing: Object.assign({ notes: 'cut list' }, template.pacing),
      slots: template.slots.map((slot) =>
        Object.assign({ fingerprint: SHA }, slot, {
          transitionIn: slot.transitionIn && Object.assign({ debugTrace: 1 }, slot.transitionIn),
        }),
      ),
    };
    const style = look();
    const richer: Style = {
      ...style,
      textStyles: Object.fromEntries(
        Object.entries(style.textStyles).map(([key, value]) => [
          key,
          Object.assign({ fontFile: 'brand.otf' }, value),
        ]),
      ),
    };
    const built = toHubTemplate(widened, meta(), { ...FORM, includeStyle: true }, richer);
    expect(built.ok).toBe(true);
    const text = JSON.stringify(built.ok ? built.value : null);
    for (const key of ['colourSpace', 'notes', 'fingerprint', 'debugTrace', 'fontFile']) {
      expect(text).not.toContain(key);
    }
  });

  it('records a hub parent when this template was itself a fork', () => {
    const parent = newId<'HubTemplate'>();
    const built = toHubTemplate(
      referenceTemplate(),
      meta({ provenance: { kind: 'hub', hubId: parent, version: 4 } }),
      FORM,
      null,
    );
    expect(built.ok && built.value.forkedFrom).toEqual({ id: parent, version: 4 });
  });
});
