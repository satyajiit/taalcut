// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A "Tell Taalcut" proposal as the person reads it (BRK1-REV): what it changes, and the before and after where
 * there is one, made from the template on screen, so "Slot 4's description: … → …" names real things. The model's
 * words (a new description, a name) are untrusted and shown as plain text; a payload the review can't read is
 * said plainly and can't be accepted.
 */
import type { I18n } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import type { DoubtReason, Template, TemplateProposal } from '@taalcut/core';
import { REVIEW_COMMANDS } from './review-commands';
import { DOUBT_WORDS } from './review-checks';
import { ROLE_LABELS, toSeconds } from './slot-words';

export interface ProposalWords {
  /** What changes: "Slot 4’s description". */
  readonly what: string;
  /** The value now, when there is one; `words` when it is someone's text (a description, a name, OCR). */
  readonly before: { readonly text: string; readonly words: boolean } | null;
  readonly after: { readonly text: string; readonly words: boolean } | null;
  /** The review can't read this proposal's payload: it is shown, never accepted. */
  readonly unreadable: boolean;
}

type Slot = Template['slots'][number];
const ROLES = ['hook', 'body', 'peak', 'outro'] as const;

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

function time(value: unknown): number | null {
  const t = record(value);
  const rate = record(t?.rate);
  if (
    typeof t?.value !== 'number' ||
    typeof rate?.num !== 'number' ||
    typeof rate.den !== 'number' ||
    !rate.num
  )
    return null;
  return toSeconds({ value: t.value, rate: { num: rate.num, den: rate.den } });
}

export function proposalWords(i18n: I18n, template: Template, proposal: TemplateProposal): ProposalWords {
  // Read defensively: what a model proposed is shown as it is, and only what the review can read is accepted.
  const p = proposal.payload as Readonly<Record<string, unknown>>;
  const seconds = (value: number) =>
    i18n.number(value, { style: 'unit', unit: 'second', unitDisplay: 'narrow', maximumFractionDigits: 2 });
  const slotOf = (id: unknown): { slot: Slot; n: string } | null => {
    const index = template.slots.findIndex((slot) => slot.id === id);
    return index < 0 ? null : { slot: template.slots[index]!, n: i18n.number(index + 1) };
  };
  const plain = (value: string) => ({ text: value, words: false });
  const words = (value: string) => ({ text: value, words: true });
  const unreadable: ProposalWords = {
    what: i18n._(msg`A change Taalcut couldn’t describe`),
    before: null,
    after: null,
    unreadable: true,
  };
  const at = slotOf(p.slotId);

  switch (proposal.command) {
    case REVIEW_COMMANDS.editIntent: {
      const next = text(record(p.intent)?.text);
      if (!at || !next) return unreadable;
      const { n } = at;
      return {
        what: i18n._(msg`Slot ${n}’s description`),
        before: at.slot.intent.text ? words(at.slot.intent.text) : null,
        after: words(next),
        unreadable: false,
      };
    }
    case REVIEW_COMMANDS.moveCut: {
      const to = time(p.to);
      if (!at || to === null) return unreadable;
      const { n } = at;
      return {
        what: i18n._(msg`The cut before slot ${n}`),
        before: plain(seconds(toSeconds(at.slot.start))),
        after: plain(seconds(to)),
        unreadable: false,
      };
    }
    case REVIEW_COMMANDS.splitSlot: {
      const cut = time(p.at);
      if (!at || cut === null) return unreadable;
      const { n } = at;
      const where = seconds(cut);
      return {
        what: i18n._(msg`A new cut in slot ${n}, at ${where}`),
        before: null,
        after: null,
        unreadable: false,
      };
    }
    case REVIEW_COMMANDS.setRole: {
      const role = ROLES.find((r) => r === p.role);
      if (!at || !role) return unreadable;
      const { n } = at;
      return {
        what: i18n._(msg`Slot ${n}’s part in the reel`),
        before: plain(i18n._(ROLE_LABELS[at.slot.role])),
        after: plain(i18n._(ROLE_LABELS[role])),
        unreadable: false,
      };
    }
    case REVIEW_COMMANDS.removeText: {
      const ids = Array.isArray(p.overlayIds) ? p.overlayIds : [];
      const gone = template.text.filter((item) => ids.includes(item.id));
      if (gone.length === 0) return unreadable;
      const count = gone.length;
      return {
        what: i18n._(
          msg`${plural(count, { one: 'Take out # line of text', other: 'Take out # lines of text' })}`,
        ),
        before: words(gone.map((item) => item.text).join(' · ')),
        after: null,
        unreadable: false,
      };
    }
    case REVIEW_COMMANDS.setTempo: {
      const bpm = template.beatMap?.bpm ?? null;
      if (p.factor !== 0.5 && p.factor !== 2) return unreadable;
      const now = bpm ? i18n.number(Math.round(bpm)) : null;
      const next = bpm ? i18n.number(Math.round(bpm * (p.factor as number))) : null;
      return {
        what: p.factor === 2 ? i18n._(msg`Twice as many beats`) : i18n._(msg`Half as many beats`),
        before: now ? plain(i18n._(msg`${now} beats a minute`)) : null,
        after: next ? plain(i18n._(msg`${next} beats a minute`)) : null,
        unreadable: false,
      };
    }
    case REVIEW_COMMANDS.dismissDoubt: {
      const reason =
        typeof p.reason === 'string' && p.reason in DOUBT_WORDS ? (p.reason as DoubtReason) : null;
      if (!reason) return unreadable;
      const doubt = i18n._(DOUBT_WORDS[reason]);
      return { what: i18n._(msg`Leave it as it is: ${doubt}`), before: null, after: null, unreadable: false };
    }
    case REVIEW_COMMANDS.mergeSlots: {
      const ids = Array.isArray(p.slotIds) ? p.slotIds : [];
      const found = ids.map(slotOf);
      if (found.length < 2 || found.some((f) => !f)) return unreadable;
      const first = found[0]!.n;
      const last = found[found.length - 1]!.n;
      return {
        what: i18n._(msg`Merge slots ${first} to ${last}`),
        before: null,
        after: null,
        unreadable: false,
      };
    }
    case REVIEW_COMMANDS.dropSlot: {
      if (!at) return unreadable;
      const { n } = at;
      return { what: i18n._(msg`Drop slot ${n}`), before: null, after: null, unreadable: false };
    }
    case REVIEW_COMMANDS.renameSlot: {
      const name = p.name === null ? null : text(p.name);
      if (!at) return unreadable;
      const { n } = at;
      return {
        what: i18n._(msg`Slot ${n}’s name`),
        before: at.slot.name ? words(at.slot.name) : null,
        after: name ? words(name) : null,
        unreadable: false,
      };
    }
    default:
      return unreadable;
  }
}

const ids = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : value ? [value] : []);

/**
 * A proposal whose slot or line is no longer in the template: a merge or drop accepted before it took the slot, or
 * the line was removed. It can't be accepted any more, and says so.
 */
export function proposalGone(template: Template, proposal: TemplateProposal): boolean {
  const p = proposal.payload as Readonly<Record<string, unknown>>;
  const slots = [...ids(p.slotId), ...ids(p.slotIds)];
  return (
    slots.some((id) => !template.slots.some((slot) => slot.id === id)) ||
    ids(p.overlayIds).some((id) => !template.text.some((line) => line.id === id))
  );
}

/** Changes that take slots away go last in Accept all, so the others still find their slots. */
export const takesSlots = (proposal: TemplateProposal): boolean =>
  proposal.command === REVIEW_COMMANDS.mergeSlots || proposal.command === REVIEW_COMMANDS.dropSlot;

/** Two proposals about a slot in common. */
export function sharesSlot(a: TemplateProposal, b: TemplateProposal): boolean {
  const slotsOf = (proposal: TemplateProposal) => {
    const p = proposal.payload as Readonly<Record<string, unknown>>;
    return [...ids(p.slotId), ...ids(p.slotIds)];
  };
  const theirs = slotsOf(b);
  return slotsOf(a).some((id) => theirs.includes(id));
}
