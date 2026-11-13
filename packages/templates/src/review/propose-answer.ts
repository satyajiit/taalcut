// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The model's answer to "Tell Taalcut", read as untrusted data. A proposal is kept only when its command is one of
 * PROPOSAL_COMMANDS, its payload parses as that command's, and it applies to the version asked about: each is tried
 * on that version with the same pure edit the command runs (so a slot or overlay that doesn't exist, a cut out of
 * range or slots that aren't adjacent are refused here, not when the person accepts). Duplicates and anything past
 * MAX_PROPOSALS are dropped too; `dropped` counts them all. Frame numbers are times at the canvas rate.
 */
import {
  err,
  MAX_PROPOSALS,
  ok,
  PROPOSAL_COMMANDS,
  PROPOSAL_WHY_MAX,
  RationalTime,
  TEMPLATE_COMMANDS as N,
  TemplateProposalsUnreadable,
  templateProposalSchema,
  type FrameRate,
  type Result,
  type Template,
  type TemplateProposal,
} from '@taalcut/core';
import { moveCut, splitSlot } from '../edits/cut-edits';
import { dismissDoubt, removeText, setRole, setTempo } from '../edits/review-edits';
import { dropSlot, editIntent, mergeSlots, renameSlot } from '../edits/slot-edits';

/** The most raw proposals read: a runaway answer isn't worth trying item by item. */
const MAX_READ = 50;
/** A split's new slot in the dry run; never stored. */
const TRIAL_SLOT = '00000000000000000000000000' as never;

export interface ReadProposals {
  readonly proposals: TemplateProposal[];
  readonly dropped: number;
  readonly note: string | null;
}

/** The first JSON object in the text: models wrap it in a code fence or a sentence despite being asked not to. */
function objectIn(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

/** One line of model text for the person: whitespace collapsed, cut at a word before `max`. */
export function oneLine(value: unknown, max = PROPOSAL_WHY_MAX): string | null {
  if (typeof value !== 'string') return null;
  const line = value.replace(/\s+/gu, ' ').trim();
  if (line.length <= max) return line || null;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}

/** A frame number becomes a time at the canvas rate; a time stays one. */
function timeOf(value: unknown, rate: FrameRate): unknown {
  return typeof value === 'number' && Number.isSafeInteger(value) ? RationalTime.of(value, rate) : value;
}

function normalised(payload: unknown, command: string, rate: FrameRate): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const fields = payload as Record<string, unknown>;
  if (command === N.moveCut) return { ...fields, to: timeOf(fields.to, rate) };
  if (command === N.splitSlot) return { ...fields, at: timeOf(fields.at, rate) };
  return fields;
}

/** The proposal tried on the template it was made for: the edit the command runs, as a person dispatches it. */
function applies(template: Template, proposal: TemplateProposal): boolean {
  const { command, payload } = proposal;
  const outcome = (() => {
    switch (command) {
      case N.moveCut:
        return moveCut(template, { ...payload, at: payload.to });
      case N.splitSlot:
        return splitSlot(template, payload, TRIAL_SLOT);
      case N.setRole:
        return setRole(template, payload);
      case N.removeText:
        return removeText(template, payload);
      case N.setTempo:
        return setTempo(template, payload);
      case N.dismissDoubt:
        return dismissDoubt(template, payload);
      case N.editIntent:
        return editIntent(template, payload, 'user');
      case N.mergeSlots:
        return mergeSlots(template, payload);
      case N.dropSlot:
        return dropSlot(template, payload);
      case N.renameSlot:
        return renameSlot(template, payload);
    }
  })();
  return outcome.ok;
}

/** What the person is shown from the model's answer; `templates.proposals_unreadable` when there is nothing to read. */
export function readProposals(text: string, template: Template): Result<ReadProposals> {
  const answer = objectIn(text);
  const raw =
    answer && typeof answer === 'object' ? (answer as Record<string, unknown>).proposals : undefined;
  if (!Array.isArray(raw))
    return err(TemplateProposalsUnreadable(undefined, { detail: 'No "proposals" array' }));
  const commands = new Set<string>(PROPOSAL_COMMANDS);
  const seen = new Set<string>();
  const proposals: TemplateProposal[] = [];
  let dropped = Math.max(0, raw.length - MAX_READ);
  for (const item of raw.slice(0, MAX_READ)) {
    const fields = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const command = typeof fields.command === 'string' ? fields.command : '';
    const parsed = commands.has(command)
      ? templateProposalSchema.safeParse({
          id: `p${proposals.length + 1}`,
          command,
          payload: normalised(fields.payload, command, template.canvas.rate),
          why: oneLine(fields.why) ?? '',
        })
      : undefined;
    const key = parsed?.success ? JSON.stringify([command, parsed.data.payload]) : '';
    if (
      !parsed?.success ||
      seen.has(key) ||
      proposals.length >= MAX_PROPOSALS ||
      !applies(template, parsed.data)
    ) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    proposals.push(parsed.data);
  }
  const note =
    answer && typeof answer === 'object' ? oneLine((answer as Record<string, unknown>).note) : null;
  return ok({ proposals, dropped, note });
}
