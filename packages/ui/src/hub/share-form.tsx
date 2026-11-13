// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V4
 * Hallmark · component: share form (U3) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the hub card's fields, unboxed: handle (remembered, "@" before it), name, description,
 *   tags, language, Include the look (off); each field's own problem under it, in words, how to fix it
 * states: default · hover (edge ink-3) · focus-visible (base ring) · active (typing) · disabled (while sending; the
 *   look's switch when the template has none, said why) · loading (n/a: the share check shows in the problems
 *   list) · error (danger edge and the line under the field) · success (n/a: the Submit's sent state says it)
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { HubShareForm } from '@taalcut/core';
import { useId, useState, type ReactNode } from 'react';
import { Input } from '../components/input';
import { Select } from '../components/select';
import { Switch } from '../components/switch';
import { cn } from '#lib/cn';
import { languageName } from './hub-words';
import { formFieldOf, problemWords, type ShareProblem } from './share-words';

const HANDLE = /^[a-z0-9][a-z0-9_.-]{1,29}$/;
const TAG = /^[a-z0-9][a-z0-9-]{0,23}$/;
const MAX_TAGS = 8;

/** The handle as the hub takes it: 2 to 30 of a–z, 0–9, dot, dash or underscore, starting with a letter or digit. */
export const isHandle = (handle: string) => HANDLE.test(handle);

function parseTags(text: string): { tags: string[]; bad: boolean } {
  const words = text
    .split(/[\s,]+/u)
    .map((word) => word.replace(/^#/u, '').toLowerCase())
    .filter(Boolean);
  const tags = [...new Set(words.filter((word) => TAG.test(word)))].slice(0, MAX_TAGS);
  return { tags, bad: words.some((word) => !TAG.test(word)) || words.length > MAX_TAGS };
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-note`} className="m-0 text-sm text-danger-strong">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-note`} className="m-0 text-sm text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface ShareFormProps {
  readonly form: HubShareForm;
  onFormChange(form: HubShareForm): void;
  readonly problems: readonly ShareProblem[];
  /** Language tags to offer; the template's own first. */
  readonly languages: readonly string[];
  /** The template has a look to include. */
  readonly hasLook: boolean;
  readonly disabled: boolean;
}

export function ShareForm({ form, onFormChange, problems, languages, hasLook, disabled }: ShareFormProps) {
  const { t, i18n } = useLingui();
  const ids = { handle: useId(), name: useId(), description: useId(), tags: useId(), language: useId() };
  const lookId = useId();
  const [tagText, setTagText] = useState(form.tags.join(', '));
  const [badTags, setBadTags] = useState(false);
  const set = (patch: Partial<HubShareForm>) => onFormChange({ ...form, ...patch });
  const fieldProblem = (field: 'name' | 'description' | 'handle' | 'tags') => {
    const found = problems.find((problem) => formFieldOf(problem) === field);
    return found ? problemWords(i18n, found) : null;
  };
  const handleError =
    form.handle !== '' && !isHandle(form.handle)
      ? t`Use 2 to 30 lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.`
      : fieldProblem('handle');
  const nameError = form.name.trim() === '' ? t`Give it a name.` : fieldProblem('name');
  const left = 280 - form.description.length;
  const described = (id: string, note: boolean) => (note ? { 'aria-describedby': `${id}-note` } : {});

  return (
    <div data-slot="share-form" className="grid gap-4 @lg:grid-cols-2">
      <Field
        id={ids.handle}
        label={t`Your handle`}
        hint={t`Shown with the template. Taalcut remembers it.`}
        error={handleError}
      >
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3"
          >
            @
          </span>
          <Input
            id={ids.handle}
            value={form.handle}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            maxLength={30}
            status={handleError ? 'error' : undefined}
            onChange={(event) => set({ handle: event.target.value.trim().toLowerCase() })}
            className="ps-7"
            {...described(ids.handle, true)}
          />
        </div>
      </Field>
      <Field id={ids.name} label={t`Name`} error={nameError}>
        <Input
          id={ids.name}
          value={form.name}
          disabled={disabled}
          maxLength={80}
          status={nameError ? 'error' : undefined}
          onChange={(event) => set({ name: event.target.value })}
          {...described(ids.name, !!nameError)}
        />
      </Field>
      <div className="@lg:col-span-2">
        <Field
          id={ids.description}
          label={t`Description`}
          hint={t`${plural(left, { one: '# character left', other: '# characters left' })}`}
          error={fieldProblem('description')}
        >
          <textarea
            id={ids.description}
            value={form.description}
            disabled={disabled}
            maxLength={280}
            rows={2}
            aria-invalid={fieldProblem('description') ? true : undefined}
            onChange={(event) => set({ description: event.target.value })}
            className={cn(
              'w-full min-w-0 resize-none rounded-md border border-rule-strong bg-raised px-3 py-2 text-base text-ink shadow-xs',
              'transition-[border-color,background-color] duration-(--dur-micro) ease-(--ease-out)',
              'placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-ink-2 focus-visible:bg-canvas',
              'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-sunken disabled:text-ink-disabled',
              'aria-invalid:border-danger-strong',
            )}
            {...described(ids.description, true)}
          />
        </Field>
      </div>
      <Field
        id={ids.tags}
        label={t`Tags`}
        hint={t`Up to 8, separated by commas: food, travel`}
        error={
          badTags ? t`Tags are up to 8 words of lowercase letters, numbers and dashes.` : fieldProblem('tags')
        }
      >
        <Input
          id={ids.tags}
          value={tagText}
          disabled={disabled}
          spellCheck={false}
          status={badTags ? 'error' : undefined}
          onChange={(event) => {
            const parsed = parseTags(event.target.value);
            setTagText(event.target.value);
            setBadTags(parsed.bad);
            set({ tags: parsed.tags });
          }}
          {...described(ids.tags, true)}
        />
      </Field>
      <Field id={ids.language} label={t`Spoken language`}>
        <Select
          id={ids.language}
          value={form.language ?? ''}
          disabled={disabled}
          onChange={(event) => set({ language: event.target.value === '' ? null : event.target.value })}
        >
          <option value="">{t`None, or it doesn’t matter`}</option>
          {languages.map((tag) => (
            <option key={tag} value={tag}>
              {languageName(i18n, tag)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-start gap-3 @lg:col-span-2">
        <Switch
          id={lookId}
          checked={form.includeStyle}
          disabled={disabled || !hasLook}
          onCheckedChange={(includeStyle) => set({ includeStyle })}
          aria-describedby={`${lookId}-note`}
        />
        <span className="flex flex-col gap-0.5">
          <label htmlFor={lookId} className="text-sm font-medium text-ink">
            {t`Include the look`}
          </label>
          <span id={`${lookId}-note`} className="text-sm text-ink-3">
            {hasLook
              ? t`Colours, fonts and caption style, without your logo or any file.`
              : t`This template has no look to include.`}
          </span>
        </span>
      </div>
    </div>
  );
}
