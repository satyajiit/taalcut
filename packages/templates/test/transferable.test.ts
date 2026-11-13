// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CAST: a template's intents fit anyone's footage. templates.setIntents refuses one that names the reel's
 * places, landmarks, signs or reel-only objects, says what to write instead, and keeps the reel's words in `reel`.
 * Made-up places only.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TemplateId } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { BREAKDOWN_FILE, type BreakdownDraft } from '../src/index';
import { intentSpecifics, reelSpecifics } from '../src/breakdown/transferable';
import { draftFixture } from './helpers/draft';
import { setupTools, type ToolSetup } from './helpers/tool-setup';

let setup: ToolSetup | undefined;
afterEach(() => setup?.cleanup());

const words = (text: string, label = false) => reelSpecifics(text, label).map((item) => item.words);

describe('reel specifics', () => {
  it('finds proper nouns, quoted text and named landmarks or objects', () => {
    expect(words('Track behind the traveler towards the Marisol Tower at night.')).toEqual([
      'Marisol Tower',
      'tower',
    ]);
    expect(words('Lake Verenta at dawn, a slow pan')).toEqual(['Lake Verenta']);
    expect(words("A shirt that reads 'SUNNY CREW' on a stage")).toContain("'SUNNY CREW'");
    expect(words('Open on a person waiting as a red train arrives')).toEqual(['train']);
    expect(words('Frame them before a pagoda')).toEqual(['pagoda']);
    // A place or subject is a label: its first word names something when it is capitalised.
    expect(words('Brindle market', true)).toEqual(['Brindle']);
  });

  it('leaves an intent that fits anyone’s footage alone', () => {
    for (const text of [
      'Track behind the traveler climbing a staircase at night, a lit landmark or skyline above them.',
      'Talking to camera, mid shot, first of three tips. Calm.',
      'POV of a paddle in the water; wide shot, slow push-in.',
      "A person walks away down a busy street at night, the camera following behind; the reel's peak.",
    ])
      expect(words(text), text).toEqual([]);
    expect(
      intentSpecifics({ text: 'A wide shot of a beach', subject: 'traveler', place: 'busy street at night' }),
    ).toEqual([]);
  });
});

async function scratchWith(s: ToolSetup, draft: BreakdownDraft) {
  const id = s.deps.ids.experiment();
  const scratch = await s.sandbox.open({ id, projectId: s.projectA, purpose: 'breakdown' });
  if (!scratch.ok) throw new Error(scratch.error.code);
  writeFileSync(join(scratch.value.dir, BREAKDOWN_FILE), JSON.stringify({ ...draft, breakdownId: id }));
  return { breakdownId: id };
}

const intent = (
  slotIndex: number,
  text = `a person walks away, shot ${slotIndex}, mid shot`,
  reel?: string,
) => ({
  slotIndex,
  intent: {
    text,
    shotType: 'medium',
    motion: 'static',
    subject: 'traveler',
    people: 1,
    place: null,
    energy: 0.5,
    ...(reel ? { reel } : {}),
  },
});

describe('templates.setIntents and the reel’s specifics', () => {
  it('rewrites an intent naming a landmark, stores it, and says what it wrote (AGT1)', async () => {
    setup = setupTools();
    const { breakdownId } = await scratchWith(setup, draftFixture());
    const stored = await setup.value<{ written: number; rewritten: unknown[]; note: string }>(
      'templates.setIntents',
      {
        breakdownId,
        intents: [
          intent(0),
          intent(1, 'The traveler faces the Marisol Tower as a red train arrives'),
          intent(2, 'The traveler walks past Brindlish lanterns at night, mid shot'),
          intent(3),
        ],
      },
    );
    expect(stored.written).toBe(4);
    expect(stored.rewritten).toEqual([
      { slotIndex: 1, field: 'text', to: 'The traveler faces the landmark as a red vehicle arrives' },
      { slotIndex: 2, field: 'text', to: 'The traveler walks past lanterns at night, mid shot' },
    ]);
    expect(stored.note).toContain("anyone's footage");
    const saved = await setup.value<{ templateId: string }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'Tower reel',
    });
    const template = await setup.service.get({ templateId: saved.templateId as TemplateId });
    const slots = template.ok ? template.value.template.slots : [];
    // The fixture's slots have no looks: the model's own words are what the reel shows.
    expect(slots[1]?.intent.reel).toBe('The traveler faces the Marisol Tower as a red train arrives');
    // A tower is a landmark, said plainly; a name with no general word for it went, so the review asks.
    expect(slots[1]?.doubts?.map((d) => d.reason) ?? []).not.toContain('intentGeneralised');
    expect(slots[2]?.doubts?.map((d) => d.reason)).toContain('intentGeneralised');
  });

  it('refuses only a slot whose rewrite says too little, with the call to make, and stores the rest', async () => {
    setup = setupTools();
    const { breakdownId } = await scratchWith(setup, draftFixture());
    const refused = await setup.call('templates.setIntents', {
      breakdownId,
      intents: [intent(0), intent(1, 'Marisol Tower.')],
    });
    expect(refused.ok || refused.error.code).toBe('core.validation');
    const detail = refused.ok ? '' : (refused.error.detail ?? '');
    expect(detail).toContain('Slot 1');
    expect(detail).toContain('"Marisol Tower"');
    expect(detail).toContain('Send slot 1 again like this: {"slotIndex":1');
    expect(detail).toContain('"reel":"Marisol Tower."');
    expect(detail).toContain('1 of 4 have an intent');
    const page = await setup.value<{ written: number }>('templates.resolveCuts', { breakdownId });
    expect(page.written).toBe(1);
  });

  it('keeps what the reel shows in reel, apart from the intent casting reads', async () => {
    setup = setupTools();
    const { breakdownId } = await scratchWith(setup, draftFixture());
    await setup.value('templates.setIntents', {
      breakdownId,
      intents: [
        intent(0, 'a person waits for transit indoors, mid shot', 'A traveler on the Brindle line platform'),
        intent(1),
        intent(2),
        intent(3),
      ],
    });
    const saved = await setup.value<{ templateId: string }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'Platform reel',
    });
    const stored = await setup.service.get({ templateId: saved.templateId as TemplateId });
    const first = stored.ok ? stored.value.template.slots[0]?.intent : undefined;
    expect(first).toMatchObject({
      text: 'a person waits for transit indoors, mid shot',
      reel: 'A traveler on the Brindle line platform',
    });
  });

  it('stores what a slot needs and whether the face shows, through to the template (FIX-HOOK)', async () => {
    setup = setupTools();
    const { breakdownId } = await scratchWith(setup, draftFixture());
    const stated = intent(0, 'a person reads a letter, then looks up, mid shot');
    await setup.value('templates.setIntents', {
      breakdownId,
      intents: [
        { ...stated, intent: { ...stated.intent, needs: ['someone reading a letter'], face: 'hidden' } },
        { ...intent(1), intent: { ...intent(1).intent, needs: [], face: 'shown' } },
        intent(2),
        intent(3),
      ],
    });
    const saved = await setup.value<{ templateId: string }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'Letter reel',
    });
    const stored = await setup.service.get({ templateId: saved.templateId as TemplateId });
    const slots = stored.ok ? stored.value.template.slots : [];
    expect(slots[0]?.intent).toMatchObject({ needs: ['someone reading a letter'], face: 'hidden' });
    expect(slots[1]?.intent).toMatchObject({ needs: [], face: 'shown' });
    expect(slots[2]?.intent).not.toHaveProperty('needs');
    const tooMany = await setup.call('templates.setIntents', {
      breakdownId,
      intents: [{ ...stated, intent: { ...stated.intent, needs: ['a', 'b', 'c', 'd'] } }],
    });
    expect(tooMany.ok).toBe(false);
  });
});
