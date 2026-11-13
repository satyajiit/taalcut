// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** BRK1-REV's contract: `template.setSoundCredit` and the sound credit's link on Template v1. */
import { describe, expect, it } from 'vitest';
import {
  soundCreditSchema,
  TEMPLATE_COMMANDS as N,
  templateCommandPayloads as P,
  templateSchema,
} from '@taalcut/core';
import { referenceTemplate } from './helpers/documents';

const template = referenceTemplate();
const edit = { projectId: null, templateId: template.id, baseVersion: 3 };
const parses = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('BRK1-REV contract: the sound credit', () => {
  it('names the command', () => {
    expect(N.setSoundCredit).toBe('template.setSoundCredit');
  });

  it('takes a title, an artist and an https link, at least one, or null to clear it', () => {
    expect(parses(P[N.setSoundCredit], { ...edit, credit: { title: 'Monsoon', artist: 'Rhea' } })).toBe(true);
    expect(parses(P[N.setSoundCredit], { ...edit, credit: { url: 'https://example.com/sound/1' } })).toBe(
      true,
    );
    expect(parses(P[N.setSoundCredit], { ...edit, credit: null })).toBe(true);
    expect(parses(P[N.setSoundCredit], { ...edit, credit: {} })).toBe(false);
    expect(parses(P[N.setSoundCredit], { ...edit, credit: { title: '   ' } })).toBe(false);
    expect(parses(P[N.setSoundCredit], { ...edit, credit: { url: 'http://example.com/sound' } })).toBe(false);
    expect(parses(P[N.setSoundCredit], { ...edit, credit: { url: 'not a link' } })).toBe(false);
    expect(parses(P[N.setSoundCredit], { ...edit, credit: { title: 'x'.repeat(201) } })).toBe(false);
    expect(parses(P[N.setSoundCredit], { ...edit, baseVersion: 0, credit: null })).toBe(false);
    expect(soundCreditSchema.parse({ title: '  Monsoon  ' })).toEqual({ title: 'Monsoon' });
  });

  it('keeps a link on the template’s sound, optional, so older templates still parse', () => {
    const sound = { title: 'Monsoon', artist: null };
    const audio = (value: unknown) => ({ ...template, audio: { ...template.audio, sound: value } });
    expect(parses(templateSchema, audio(sound))).toBe(true);
    expect(parses(templateSchema, audio({ ...sound, url: 'https://example.com/sound/1' }))).toBe(true);
    expect(parses(templateSchema, audio({ ...sound, url: null }))).toBe(true);
    expect(parses(templateSchema, audio({ ...sound, url: 'ftp://example.com/sound' }))).toBe(false);
  });
});
