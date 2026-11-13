// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Tell Taalcut (BRK1-REV) · system: DESIGN.md v0.7 (violet is the AI: the AI mark
 *   leads what Taalcut proposes; teal is you once you accept)
 * for anything the direct fixes don't cover: you say what's off, for this slot or the whole reel, and Taalcut answers
 *   with changes as a readable diff ("Slot 4's description: … → …") and one line on why each. Nothing changes until
 *   you accept one; each accept is its own command, undoable like any fix. Accept all takes the rest, the ones that
 *   take slots away (merge, drop) last, and stops at a failure; a proposal whose slot has gone says it no longer applies
 * states: idle (the field, Send) · asking (Send spins, the field waits) · answered (the proposals, each Accept and
 *   Reject; the model's note; who answered, and that the frames left this Mac when they did) · nothing to change (the
 *   note alone) · failed (the cause and Try again) · accepted (teal "Done", the row stays) · rejected (the row dims and
 *   says so) · gone (dimmed: no longer applies) · accept failed (the cause under the row) · disabled (read-only)
 * motion: the answer arrives with the chat's Arrival (rise and fade, 40 ms apart); reduced motion: a fade
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type {
  Result,
  TaalcutError,
  Template,
  TemplateProposal,
  TemplateProposals,
  TemplateProposeEditsInput,
} from '@taalcut/core';
import { useEffect, useId, useRef, useState } from 'react';
import { AiMark } from '#components/ai-mark';
import { ArrivalItem, ArrivalList } from '#components/arrival-list';
import { Button } from '#components/button';
import { Segmented } from '#components/segmented';
import { UserContent } from '../cards/card-frame';
import { ErrorLine } from '../cards/error-line';
import { Diff } from './proposal-diff';
import { proposalGone, proposalWords, sharesSlot, takesSlots, type ProposalWords } from './proposal-words';
import { REVIEW_COMMANDS } from './review-commands';
import { reveal } from './reveal';
import { REVIEW_ICONS } from './review-icons';

export interface TellTaalcutProps {
  template: Template;
  selected: number;
  propose: (input: TemplateProposeEditsInput) => Promise<Result<TemplateProposals>>;
  /** Dispatches an accepted proposal; false when it failed (the cause shows under the row). */
  accept: (proposal: TemplateProposal) => Promise<TaalcutError | null>;
  /** The proposals accepted in this review and not undone since: an undone one is open again. */
  accepted: ReadonlySet<TemplateProposal>;
  disabled?: boolean;
}

type Asked =
  | { readonly status: 'idle' }
  | { readonly status: 'asking' }
  | { readonly status: 'failed'; readonly error: TaalcutError }
  | {
      readonly status: 'answered';
      /** This answer's number in the session: what was decided about its rows is kept under it. */
      readonly seq: number;
      readonly answer: TemplateProposals;
      /** Each proposal in words on the version it was made for: an accepted merge still reads as the merge. */
      readonly words: ReadonlyMap<string, ProposalWords>;
    };

type Decided = 'accepting' | 'rejected' | { readonly error: TaalcutError };
/** What was asked about one slot, or the whole reel: the words being written, and the answer. */
interface Thread {
  readonly draft: string;
  readonly asked: Asked;
}
const IDLE: Thread = { draft: '', asked: { status: 'idle' } };
type State = Decided | 'accepted' | 'gone' | 'replaced' | undefined;

/** Waits until the template on screen is no longer `before` (the version a merge made has arrived), a moment at most. */
async function arrived(latest: { readonly current: Template }, before: Template): Promise<void> {
  for (let waited = 0; latest.current === before && waited < 1500; waited += 50)
    await new Promise((resolve) => window.setTimeout(resolve, 50));
}

export function TellTaalcut({
  template,
  selected,
  propose,
  accept,
  accepted,
  disabled = false,
}: TellTaalcutProps) {
  const { t, i18n } = useLingui();
  const id = useId();
  const [scope, setScope] = useState<'slot' | 'reel'>('slot');
  const number = i18n.number(selected + 1);
  const slot = template.slots[selected];
  // What you asked belongs to what it was about: each slot (and the whole reel) keeps its own draft and answer, so
  // moving to another slot shows that slot's, and an answer that arrives after the move goes to its own slot.
  const about = scope === 'reel' || !slot ? 'reel' : slot.id;
  const [threads, setThreads] = useState<Readonly<Record<string, Thread>>>({});
  const [decisions, setDecisions] = useState<Readonly<Record<string, Decided>>>({});
  const answers = useRef(0);
  const thread = threads[about] ?? IDLE;
  const update = (key: string, change: Partial<Thread>) =>
    setThreads((all) => ({ ...all, [key]: { ...(all[key] ?? IDLE), ...change } }));
  const message = thread.draft;
  const setMessage = (draft: string) => update(about, { draft });
  const asked = thread.asked;
  const decisionKey = (proposal: TemplateProposal) =>
    asked.status === 'answered' ? `${asked.seq}/${proposal.id}` : null;
  const decided = (proposal: TemplateProposal) => {
    const key = decisionKey(proposal);
    return key ? decisions[key] : undefined;
  };
  const setDecided = (proposal: TemplateProposal, value: Decided | null) => {
    const key = decisionKey(proposal);
    if (key)
      setDecisions((was) => {
        const { [key]: _was, ...rest } = was;
        return value === null ? rest : { ...rest, [key]: value };
      });
  };
  // The slot it was about went (a merge or a drop, perhaps one it proposed): its thread goes on with the slot that
  // took its place, the one the review moved to.
  const was = useRef(about);
  useEffect(() => {
    const before = was.current;
    was.current = about;
    if (before === about || before === 'reel' || template.slots.some((other) => other.id === before)) return;
    setThreads((all) => (all[before] && !all[about] ? { ...all, [about]: all[before] } : all));
  }, [about, template]);

  const send = async () => {
    const words = message.trim();
    const target = about;
    if (!words || asked.status === 'asking') return;
    update(target, { asked: { status: 'asking' } });
    const result = await propose({
      templateId: template.id,
      baseVersion: template.version,
      ...(scope === 'slot' && slot ? { slotIds: [slot.id] } : {}),
      message: words,
    });
    update(target, {
      asked: result.ok
        ? {
            status: 'answered',
            seq: (answers.current += 1),
            answer: result.value,
            words: new Map(result.value.proposals.map((p) => [p.id, proposalWords(i18n, template, p)])),
          }
        : { status: 'failed', error: result.error },
    });
  };

  /**
   * A row's buttons give way to "Accepted" or "Rejected": focus goes on to the next open proposal, else stays on the
   * row (never the field: ⌘Z there would edit the words instead of undoing the change). Looked for again while the
   * new version arrives, so it never falls to the sheet.
   */
  const onDecided = (proposal: TemplateProposal) => {
    for (const [i, wait] of [0, 120, 400, 900].entries())
      window.setTimeout(
        () =>
          requestAnimationFrame(() => {
            const at = document.activeElement;
            const lost =
              !(at instanceof HTMLElement) || at === document.body || at.getAttribute('role') === 'dialog';
            if (i > 0 && !lost && at.isConnected) return;
            const box = answered.current;
            const next =
              box?.querySelector<HTMLElement>(
                '[data-slot=proposal][data-state=open] button:not(:disabled)',
              ) ?? box?.querySelector<HTMLElement>(`[data-proposal="${proposal.id}"]`);
            next?.focus({ preventScroll: true });
          }),
        wait,
      );
  };

  const decide = async (proposal: TemplateProposal) => {
    setDecided(proposal, 'accepting');
    const error = await accept(proposal);
    setDecided(proposal, error ? { error } : null);
    if (!error) onDecided(proposal);
    return !error;
  };

  const answer = asked.status === 'answered' ? asked.answer : null;
  const wordsOf = (proposal: TemplateProposal) =>
    (asked.status === 'answered' ? asked.words.get(proposal.id) : undefined) ??
    proposalWords(i18n, template, proposal);
  const stateOf = (proposal: TemplateProposal): State => {
    const gone = proposalGone(template, proposal);
    // Accepted, then a later merge or drop took its slot: the template no longer holds it, so it doesn't say Accepted.
    if (accepted.has(proposal)) return gone && !takesSlots(proposal) ? 'replaced' : 'accepted';
    const was = decided(proposal);
    // Its slot went with an accepted merge or drop: it no longer applies (an Undo brings it back).
    return gone && (was === undefined || typeof was === 'object') ? 'gone' : was;
  };
  /** What took a replaced proposal's slot: an accepted merge or drop among these answers, if one did. */
  const replacedBy = (proposal: TemplateProposal) =>
    answer?.proposals.find((other) => accepted.has(other) && takesSlots(other) && sharesSlot(other, proposal))
      ?.command;
  const latest = useRef(template);
  useEffect(() => {
    latest.current = template;
  });
  const answered = useRef<HTMLDivElement>(null);
  // The answer comes into view where it arrives, in the panel's scroll.
  useEffect(() => {
    if (answer) reveal(answered.current);
  }, [answer]);
  const open = answer?.proposals.filter((p) => stateOf(p) === undefined) ?? [];
  const left = i18n.number(open.length);
  const model = answer?.model.model ?? '';
  const provider = answer?.model.provider ?? '';
  /**
   * Merges and drops first, each on the version the last one made, so what they take says "No longer applies"
   * rather than Accepted over a change the merge then replaced: each row says what the template holds. Stops at a
   * failure.
   */
  const acceptAll = async () => {
    const order = [...open].sort((a, b) => Number(takesSlots(b)) - Number(takesSlots(a)));
    for (const proposal of order) {
      if (wordsOf(proposal).unreadable || proposalGone(latest.current, proposal)) continue;
      const before = latest.current;
      if (!(await decide(proposal))) return;
      if (takesSlots(proposal)) await arrived(latest, before);
    }
  };

  return (
    <section
      data-slot="tell-taalcut"
      aria-labelledby={`${id}-title`}
      // Positioned: its screen-reader labels stay inside the closed Collapse, not under the sheet's scroll.
      className="relative flex flex-col gap-3"
    >
      <h3 id={`${id}-title`} className="m-0 flex items-center gap-1.5 type-card-title text-ink">
        <AiMark className="size-4" />
        {t`Tell Taalcut what’s off`}
      </h3>
      <Segmented
        label={t`About`}
        value={scope}
        onChange={setScope}
        options={[
          { value: 'slot', label: t`Slot ${number}` },
          { value: 'reel', label: t`The whole reel` },
        ]}
        disabled={disabled || asked.status === 'asking'}
      />
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor={`${id}-message`} className="sr-only">
          {t`What’s off`}
        </label>
        <textarea
          id={`${id}-message`}
          value={message}
          maxLength={2000}
          rows={2}
          disabled={disabled}
          readOnly={asked.status === 'asking'}
          placeholder={t`The cut comes a beat late, and it’s a train window, not a car`}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
          className="min-h-16 w-full resize-y rounded-md border border-rule-strong bg-raised px-3 py-2 type-body text-ink shadow-xs placeholder:text-ink-3 hover:border-ink-3 focus:border-ink-2 focus:bg-canvas disabled:bg-sunken"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            icon={REVIEW_ICONS.send}
            loading={asked.status === 'asking'}
            disabled={disabled || !message.trim()}
          >
            {asked.status === 'asking' ? t`Asking Taalcut` : t`Ask for changes`}
          </Button>
          <span data-slot="tell-sends" className="type-meta text-ink-2">
            {t`Your words and the reel’s frames go to the model that describes frames, as when Taalcut read the reel. Nothing changes until you accept it.`}
          </span>
        </div>
      </form>
      {asked.status === 'failed' ? <ErrorLine error={asked.error} onRetry={() => void send()} /> : null}
      {/* Said when the answer arrives, while focus stays where it was. */}
      <p role="status" className="sr-only">
        {answer && answer.proposals.length > 0
          ? t`${plural(answer.proposals.length, { one: 'Taalcut proposes # change', other: 'Taalcut proposes # changes' })}`
          : null}
      </p>
      {answer ? (
        <div ref={answered} data-slot="proposals" className="flex flex-col gap-2">
          {answer.note ? (
            <p className="m-0 flex items-start gap-1.5 type-body text-ink">
              <AiMark className="mt-1 size-3.5 shrink-0" label={t`Taalcut`} />
              <UserContent translate="no">{answer.note}</UserContent>
            </p>
          ) : null}
          {answer.proposals.length === 0 && !answer.note ? (
            <p className="m-0 type-body text-ink-2">{t`Taalcut found nothing to change.`}</p>
          ) : null}
          <ArrivalList className="m-0 flex list-none flex-col gap-2 p-0">
            {answer.proposals.map((proposal, index) => {
              const state = stateOf(proposal);
              const words = wordsOf(proposal);
              return (
                <ArrivalItem key={proposal.id} index={index}>
                  <div
                    data-slot="proposal"
                    data-proposal={proposal.id}
                    tabIndex={-1}
                    data-state={typeof state === 'object' ? 'failed' : (state ?? 'open')}
                    className="flex flex-col gap-2 rounded-lg border border-rule-subtle p-3 data-[state=gone]:opacity-60 data-[state=rejected]:opacity-60 data-[state=replaced]:opacity-60"
                  >
                    <Diff words={words} />
                    <p className="m-0 type-meta text-ink-2">
                      <UserContent translate="no">{proposal.why}</UserContent>
                    </p>
                    {state === 'accepted' ? (
                      <p role="status" className="m-0 type-label-sm text-you-strong">{t`Accepted`}</p>
                    ) : state === 'rejected' ? (
                      <p className="m-0 type-label-sm text-ink-2">{t`Rejected`}</p>
                    ) : state === 'gone' ? (
                      <p className="m-0 type-label-sm text-ink-2">{t`No longer applies: its slot has changed`}</p>
                    ) : state === 'replaced' ? (
                      <p role="status" className="m-0 type-label-sm text-ink-2">
                        {replacedBy(proposal) === REVIEW_COMMANDS.dropSlot
                          ? t`Replaced: its slot was dropped`
                          : replacedBy(proposal) === REVIEW_COMMANDS.mergeSlots
                            ? t`Replaced by the merge`
                            : t`Replaced: its slot has changed since`}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          icon={REVIEW_ICONS.looksRight}
                          loading={state === 'accepting'}
                          disabled={disabled || words.unreadable}
                          onClick={() => void decide(proposal)}
                        >
                          {t`Accept`}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={state === 'accepting'}
                          onClick={() => {
                            setDecided(proposal, 'rejected');
                            onDecided(proposal);
                          }}
                        >
                          {t`Reject`}
                        </Button>
                      </div>
                    )}
                    {typeof state === 'object' ? <ErrorLine error={state.error} /> : null}
                  </div>
                </ArrivalItem>
              );
            })}
          </ArrivalList>
          {open.length > 1 ? (
            <div>
              <Button size="sm" variant="secondary" onClick={() => void acceptAll()} disabled={disabled}>
                {t`Accept all ${left}`}
              </Button>
            </div>
          ) : null}
          <p data-slot="proposals-model" className="m-0 type-meta text-ink-2">
            {answer.model.local
              ? t`Answered by ${model}, which runs here: nothing was sent.`
              : t`Answered by ${model}. Your words and the reel’s frames went to ${provider}.`}
          </p>
        </div>
      ) : null}
    </section>
  );
}
