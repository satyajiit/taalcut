// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** shareCheck points each content hit at a slot and a field, and still returns the document. */
import { describe, expect, it } from 'vitest';
import { hubIdSchema, type HubShareForm, type Template } from '@taalcut/core';
import { shareCheck } from '../../src/hub/share-check';
import { T0, referenceTemplate } from '../helpers/fixtures';
import { FORM, hubIds, meta } from './helpers';

function check(template: Template, form: HubShareForm = FORM, card = meta()) {
  return shareCheck({
    template,
    meta: card,
    form,
    style: null,
    ids: hubIds(),
    now: T0,
  });
}

describe('shareCheck', () => {
  it('maps a url, an email and a handle onto the slot and the field', () => {
    const template = referenceTemplate();
    const slots = template.slots.map((slot) => ({ ...slot, intent: { ...slot.intent } }));
    slots[2]!.intent.text = 'see https://example.com/a';
    slots[1]!.intent.subject = 'a@b.co';
    slots[0]!.intent.place = 'follow @creator';
    const result = check({ ...template, slots });
    expect(result.document).not.toBeNull();
    expect(result.problems.length).toBeLessThanOrEqual(50);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'url',
          slotIndex: 2,
          field: 'text',
          path: 'structure.slots.2.intent.text',
        }),
        expect.objectContaining({ rule: 'email', slotIndex: 1, field: 'subject' }),
        expect.objectContaining({ rule: 'handle', slotIndex: 0, field: 'place' }),
      ]),
    );
  });

  it('returns no document when the hub shape cannot be built', () => {
    const template = referenceTemplate();
    const slots = template.slots.map((slot, index) =>
      index === 0 ? { ...slot, intent: { ...slot.intent, text: '' } } : slot,
    );
    const result = check({ ...template, slots });
    expect(result.document).toBeNull();
    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'schema',
          slotIndex: 0,
          field: 'text',
          path: 'structure.slots.0.intent.text',
        }),
      ]),
    );
  });

  it('passes a hub id with nine digits in a row when the prose is clean', () => {
    const hubId = hubIdSchema.parse('01ARZ3NDEK0123456789ABCDEF');
    const result = check(referenceTemplate(), FORM, meta({ hubId }));
    expect(result.document?.id).toBe(hubId);
    expect(result.problems).toEqual([]);
  });

  it('finds a file path and a link in the form fields', () => {
    const form = { ...FORM, name: 'Day one www.example', description: 'Cut from /Users/maya/Movies/goa' };
    const result = check(referenceTemplate(), form);
    expect(result.document).not.toBeNull();
    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name', rule: 'www', slotIndex: null }),
        expect.objectContaining({ path: 'description', rule: 'path', slotIndex: null }),
      ]),
    );
  });
});
