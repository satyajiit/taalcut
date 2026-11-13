// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: tag dialog · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * for one template or many: each tag they carry with a box (ticked on all, a dash on some, empty on none), a field
 *   to add one, the library's most used tags to add with a press; Save tags is the dialog's one strong action
 * states: boxes default · hover · focus-visible (base ring) · active (pressed) · checked/mixed · disabled (while
 *   saving); field: default · focus-visible · error (the rule in words under it); Save: default · loading · error
 *   (the cause in the toast, the dialog stays) · success (closes, the toast says so, with Undo) · disabled (nothing
 *   changed)
 * pre-emit critique: P5 H5 E4 S5 R4 V4
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { TEMPLATE_COMMANDS, type TemplateSummary } from '@taalcut/core';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@taalcut/ui';
import { Check, Minus, Plus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { MAX_TEMPLATE_TAGS, nextState, normaliseTag, planTags, tagStates, type TagState } from './tag-edits';
import { useLibraryCommands } from './use-library-commands';

export interface TagDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly templates: readonly TemplateSummary[];
  /** The library's tags, most used first (suggestions). */
  readonly suggestions: readonly string[];
}

function TagBox({ tag, state, onToggle }: { tag: string; state: TagState; onToggle: () => void }) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
        onClick={onToggle}
        className="flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-2 text-start text-base text-ink transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover active:bg-pressed"
      >
        <span
          aria-hidden
          className={cn(
            'flex size-[1.125rem] shrink-0 items-center justify-center rounded-sm border border-rule-strong bg-raised',
            state !== 'off' && 'border-primary-strong bg-primary text-primary-ink',
          )}
        >
          {state === 'on' ? <Check className="size-3.5" strokeWidth={3} /> : null}
          {state === 'mixed' ? <Minus className="size-3.5" strokeWidth={3} /> : null}
        </span>
        <span translate="no" data-user-content className="truncate">
          {tag}
        </span>
      </button>
    </li>
  );
}

function TagForm({
  templates,
  suggestions,
  onClose,
}: Omit<TagDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const { t } = useLingui();
  const fieldId = useId();
  const commands = useLibraryCommands();
  const [states, setStates] = useState(() => tagStates(templates));
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const plan = useMemo(() => planTags(templates, states), [templates, states]);
  const offered = suggestions.filter((tag) => !states.has(tag)).slice(0, 8);
  const count = templates.length;

  const add = (raw: string) => {
    const tag = normaliseTag(raw);
    if (!tag) {
      setProblem(t`Use letters and numbers, with hyphens between words, up to 32 characters.`);
      return;
    }
    setStates((prev) => new Map(prev).set(tag, 'on'));
    setText('');
    setProblem(null);
  };

  const save = async () => {
    if (!plan.ok) return;
    const done = await commands.run({
      steps: plan.steps.map(({ templateId, tags }) => ({
        name: TEMPLATE_COMMANDS.setTags,
        payload: { projectId: null, templateId, tags },
      })),
      done: (
        <Plural value={plan.steps.length} one="Tags saved on # template" other="Tags saved on # templates" />
      ),
      failed: t`Couldn’t save the tags`,
    });
    if (done.ok) onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <Plural value={count} one="Tag # template" other="Tag # templates" />
        </DialogTitle>
        <DialogDescription>
          {count > 1
            ? t`A ticked tag goes on every one; a dash means some have it, and stays as it is.`
            : t`Tags help you find templates later. Tick or untick, then save.`}
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) add(text);
        }}
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={fieldId} className="sr-only">
            {t`New tag`}
          </label>
          <Input
            id={fieldId}
            value={text}
            placeholder={t`Add a tag, like travel or शादी`}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${fieldId}-problem` : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setProblem(null);
            }}
          />
          {problem ? (
            <p id={`${fieldId}-problem`} className="m-0 text-xs text-danger-strong">
              {problem}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={!text.trim()}>
          <Plus aria-hidden />
          {t`Add`}
        </Button>
      </form>
      {states.size > 0 ? (
        <ul aria-label={t`Tags`} className="m-0 flex max-h-64 list-none flex-col overflow-y-auto p-0">
          {[...states].map(([tag, state]) => (
            <TagBox
              key={tag}
              tag={tag}
              state={state}
              onToggle={() => setStates((prev) => new Map(prev).set(tag, nextState(state)))}
            />
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-ink-2">{t`No tags yet.`}</p>
      )}
      {offered.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-ink-3">{t`Used in your library`}</span>
          <div className="flex flex-wrap gap-1.5">
            {offered.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => add(tag)}
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-pill bg-chip px-2.5 text-xs font-semibold text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink active:bg-pressed"
              >
                <Plus aria-hidden className="size-3" />
                <span translate="no" data-user-content>
                  {tag}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {!plan.ok ? (
        <p role="alert" className="m-0 text-sm text-danger-strong">
          <Trans>A template can carry {MAX_TEMPLATE_TAGS} tags at most. Untick some first.</Trans>
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t`Cancel`}
        </Button>
        <Button
          variant="primary"
          loading={commands.pending}
          disabled={!plan.ok || plan.steps.length === 0}
          onClick={() => void save()}
        >
          {t`Save tags`}
        </Button>
      </DialogFooter>
    </>
  );
}

export function TagDialog({ open, onOpenChange, templates, suggestions }: TagDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {open ? (
          <TagForm templates={templates} suggestions={suggestions} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
