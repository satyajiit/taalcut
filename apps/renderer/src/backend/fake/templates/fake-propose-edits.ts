// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- the fake model's answer: model output, never translated */

/**
 * BRK1-REV: "Tell Taalcut" in the renderer's fake (templates.proposeEdits, contract §2). A scripted model reads the
 * person's words for what they name (a cut, one shot, a description, text, the tempo) and answers proposals on the
 * slots asked about; asked nothing it recognises, it answers what the breakdown wasn't sure of; with nothing there
 * either, a note and no proposals. Nothing is applied: the review dispatches what the person accepts.
 */
import {
  ConflictError,
  NotFoundError,
  toRpcError,
  type Doubt,
  type DoubtReason,
  type Id,
  type Template,
  type TemplateProposal,
  type TemplateProposals,
  type TemplateProposeEditsInput,
} from '@taalcut/core';

type Doubted = { readonly doubts?: readonly Doubt[] | undefined };

export const FAKE_PROPOSE_MODEL = {
  provider: 'OpenRouter',
  model: 'google/gemini-2.5-flash',
  local: false,
} as const;

/** Better words for the fake plans' vague descriptions. */
const CLEARER: Readonly<Record<string, string>> = {
  'A street': 'A wet street at dusk, shop lights shining in the puddles, held still',
  'Something by the sea': 'Waves breaking over a sea wall, spray caught in the low sun',
};

const has = (item: Doubted, reason: DoubtReason) =>
  item.doubts?.some((doubt) => doubt.reason === reason) ?? false;

export function fakeProposeEdits(
  template: Template,
  input: Pick<TemplateProposeEditsInput, 'baseVersion' | 'slotIds' | 'message'>,
): TemplateProposals {
  const words = input.message.toLowerCase();
  const asked = input.slotIds?.length ? new Set(input.slotIds) : null;
  const slots = template.slots.filter((slot) => !asked || asked.has(slot.id));
  const proposals: TemplateProposal[] = [];
  // Shapes core's templateProposalSchema checks again on the way out.
  const add = (command: TemplateProposal['command'], payload: Record<string, unknown>, why: string) =>
    proposals.push({ id: `p${proposals.length + 1}`, command, payload, why } as TemplateProposal);
  const beats = template.beatMap?.beats ?? [];
  const beatSeconds = beats.map((beat) => (beat.value * beat.rate.den) / beat.rate.num);
  const seconds = (frames: number) => (frames * template.canvas.rate.den) / template.canvas.rate.num;

  const cut = (slot: Template['slots'][number], later: boolean | null) => {
    const index = template.slots.indexOf(slot);
    if (index <= 0 || beatSeconds.length === 0) return;
    const now = seconds(slot.start.value);
    const before = seconds(template.slots[index - 1]!.start.value);
    const end = seconds(slot.start.value + slot.duration.value);
    const inside = beatSeconds.filter(
      (beat) => beat > before + 0.05 && beat < end - 0.05 && Math.abs(beat - now) > 0.01,
    );
    const target =
      later === true
        ? inside.find((beat) => beat > now)
        : later === false
          ? [...inside].reverse().find((beat) => beat < now)
          : inside.reduce<number | undefined>(
              (best, beat) =>
                best === undefined || Math.abs(beat - now) < Math.abs(best - now) ? beat : best,
              undefined,
            );
    if (target === undefined) return;
    const rate = template.canvas.rate;
    add(
      'template.slot.moveCut',
      { slotId: slot.id, to: { value: Math.round((target * rate.num) / rate.den), rate }, snap: 'beat' },
      later === true
        ? 'The cut comes before the move it should land on; the next beat is where the shot changes.'
        : later === false
          ? 'The cut lands after the beat; the beat before it is where the shot changes.'
          : 'The cut is just off the beat; the nearest beat is where the picture changes.',
    );
  };
  const merge = (slot: Template['slots'][number]) => {
    const index = template.slots.indexOf(slot);
    const before = template.slots[index - 1];
    if (!before) return;
    add(
      'template.slot.merge',
      { slotIds: [before.id, slot.id], intentFrom: before.id },
      'The picture carries on across this cut: it is one shot, so one slot.',
    );
  };
  const describe = (slot: Template['slots'][number]) => {
    const text =
      CLEARER[slot.intent.text] ??
      `${slot.intent.text}, the camera ${slot.intent.motion === 'static' ? 'still' : 'moving'}`;
    add(
      'template.slot.editIntent',
      { slotId: slot.id, intent: { text } },
      'Says what is in the frame and how it moves, so a clip can be matched to it.',
    );
  };
  const sceneText = () => {
    const doubted = template.text.filter(
      (item) => has(item, 'textMaybeScene') && (!asked || (item.slotId !== null && asked.has(item.slotId))),
    );
    if (doubted.length > 0)
      add(
        'template.text.remove',
        { overlayIds: doubted.map((item) => item.id) },
        'That is a sign in the scene, not text added over the reel.',
      );
  };

  const target = slots[0];
  let matched = false;
  const oneShot = /one shot|same shot|merge|not a cut/.test(words);
  if (oneShot && target) {
    matched = true;
    merge(target);
  }
  if (!oneShot && /\b(early|late|cut|beat|snap)/.test(words) && target) {
    matched = true;
    cut(target, /early|later/.test(words) ? true : /\blate\b|earlier/.test(words) ? false : null);
  }
  if (/describ|vague|words|says/.test(words)) {
    matched = true;
    for (const slot of slots.slice(0, 3)) describe(slot);
  }
  if (/text|sign|caption/.test(words)) {
    matched = true;
    sceneText();
  }
  if (/tempo|slow|fast|half|double/.test(words) && template.beatMap) {
    matched = true;
    add(
      'template.setTempo',
      { factor: /slow|half/.test(words) ? 0.5 : 2 },
      /slow|half/.test(words)
        ? 'The beat is counted twice as fast as the music.'
        : 'The beat is counted half as fast as the music.',
    );
  }
  if (!matched) {
    for (const slot of slots) {
      if (has(slot, 'cutUnsure')) cut(slot, null);
      if (has(slot, 'cutMaybeTransition')) merge(slot);
      if (has(slot, 'intentVague')) describe(slot);
    }
    sceneText();
  }
  return {
    baseVersion: input.baseVersion,
    proposals: proposals.slice(0, 12),
    dropped: Math.max(0, proposals.length - 12),
    note:
      proposals.length === 0
        ? 'Nothing here looks off to me. Say which slot and what is wrong, and I will try again.'
        : null,
    model: FAKE_PROPOSE_MODEL,
  };
}

/** `templates.proposeEdits` as the fake serves it: answers after a moment, as a model would; a stale base is core.conflict. */
export async function fakeProposeEditsFor(
  templates: { get(templateId: Id<'Template'>): Promise<{ readonly template: Template } | null> },
  input: TemplateProposeEditsInput,
  latencyMs = 900,
): Promise<TemplateProposals> {
  const found = await templates.get(input.templateId);
  if (!found) throw toRpcError(NotFoundError({ entity: 'template', id: input.templateId }));
  if (found.template.version !== input.baseVersion)
    throw toRpcError(ConflictError({ entity: 'template', id: input.templateId }));
  await new Promise((resolve) => setTimeout(resolve, latencyMs));
  return fakeProposeEdits(found.template, input);
}
