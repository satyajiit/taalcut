// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: design variables (HFW1-UI) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · "Words and colours": a designed graphic's variables as plain controls under their names
 *   (the model's identifiers in words, shown as content): words and numbers as inputs (leaving one that changed,
 *   or Return, saves it), a colour as the system's colour well beside its hex, a choice as segmented pills, a flag
 *   as a switch (both save at once); every save is graphics.edit { params } (one ⌘Z each). The design itself is
 *   the AI's: this changes only what its variables let a person change
 * states: default · hover · focus-visible (each control's base ring) · active · disabled (no app actions, or the
 *   graphic is gone) · loading (the control being saved is read-only and busy) · error (danger edge and the reason
 *   under it: empty, too long, not a number, out of range, or the command's) · success (green edge on the input
 *   just saved) · empty: nothing (a design without variables)
 * pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { GraphicParam, GraphicParamValues, TaalcutError } from '@taalcut/core';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { UserContent } from '../cards/card-frame';
import { Input } from '#components/input';
import { Segmented } from '#components/segmented';
import { Switch } from '#components/switch';
import { designValues, variableWords, type DesignValue } from './design-reads';
import { mediaErrorMessage } from './media-errors';
import { ColourWell } from './colour-well';

export interface DesignVariablesProps {
  readonly variables: readonly GraphicParam[];
  /** The graphic's own values (absent ones show the variable's default). */
  readonly params: GraphicParamValues | undefined;
  readonly disabled: boolean;
  /** Saves one variable's value as graphics.edit { params }; resolves true once saved. `key` names the control. */
  readonly onSave: (key: string, params: GraphicParamValues) => Promise<boolean>;
  readonly busy: string | null;
  readonly error: { readonly key: string; readonly error: TaalcutError } | null;
}

type Problem = 'required' | 'tooLong' | 'number' | 'range';

/** The control's key for its variable: what busy, error and success name. */
export const variableKey = (name: string) => `variable.${name}`;

const draftOf = (value: DesignValue, locale: string) =>
  typeof value === 'number'
    ? new Intl.NumberFormat(locale, { useGrouping: false }).format(value)
    : String(value);

/** A number as the person typed it, in their language's decimal mark; NaN when it isn't one. */
function parseNumber(draft: string, locale: string): number {
  const mark = new Intl.NumberFormat(locale)
    .formatToParts(1.5)
    .find((part) => part.type === 'decimal')?.value;
  const plain = draft.trim().replaceAll(mark ?? '.', '.');
  return plain === '' || !/^-?\d*\.?\d+$/.test(plain) ? Number.NaN : Number(plain);
}

export function DesignVariablesForm({
  variables,
  params,
  disabled,
  onSave,
  busy,
  error,
}: DesignVariablesProps) {
  const { t, i18n } = useLingui();
  const values = designValues(variables, params);
  const shown = JSON.stringify(values);
  const drafted = () =>
    Object.fromEntries(Object.entries(values).map(([name, value]) => [name, draftOf(value, i18n.locale)]));
  const [drafts, setDrafts] = useState<Record<string, string>>(drafted);
  const [problems, setProblems] = useState<Readonly<Record<string, Problem>>>({});
  const [saved, setSaved] = useState<string | null>(null);

  // The graphic changed elsewhere (⌘Z, the agent): the controls show it.
  useEffect(() => {
    setDrafts(drafted());
    setProblems({});
    // `shown` stands for the values by value.
  }, [shown, i18n.locale]);

  if (variables.length === 0) return null;

  const save = async (variable: GraphicParam, value: DesignValue) => {
    if (value === values[variable.name]) return;
    if (await onSave(variableKey(variable.name), { [variable.name]: value })) setSaved(variable.name);
  };
  const commit = (variable: GraphicParam) => {
    const draft = drafts[variable.name] ?? '';
    let problem: Problem | null = null;
    let value: DesignValue = draft;
    if (variable.type === 'text') {
      if (draft.trim() === '') problem = 'required';
      else if (draft.length > variable.maxLength) problem = 'tooLong';
    } else if (variable.type === 'number') {
      value = parseNumber(draft, i18n.locale);
      if (Number.isNaN(value)) problem = 'number';
      else if (value < variable.min || value > variable.max) problem = 'range';
    }
    setProblems(({ [variable.name]: _was, ...rest }) =>
      problem ? { ...rest, [variable.name]: problem } : rest,
    );
    if (!problem) void save(variable, value);
  };

  const problemWords = (variable: GraphicParam, problem: Problem): string => {
    if (problem === 'required') return t`Write something here.`;
    if (problem === 'tooLong') return t`That’s too long for the graphic.`;
    if (problem === 'number') return t`Write a number.`;
    const min = variable.type === 'number' ? i18n.number(variable.min) : '';
    const max = variable.type === 'number' ? i18n.number(variable.max) : '';
    return t`Use a number from ${min} to ${max}.`;
  };

  return (
    <section
      data-slot="design-variables"
      aria-label={t`Words and colours`}
      className="@container flex flex-col gap-2"
    >
      <h4 className="m-0 type-label text-ink">{t`Words and colours`}</h4>
      <div className="grid gap-3 @md:grid-cols-2">
        {variables.map((variable) => {
          const key = variableKey(variable.name);
          const problem = problems[variable.name];
          const failure = problem
            ? problemWords(variable, problem)
            : error?.key === key
              ? mediaErrorMessage(i18n, error.error)
              : null;
          const value = values[variable.name];
          return (
            <Field key={variable.name} name={variable.name} problem={failure}>
              {(ids) =>
                variable.type === 'enum' ? (
                  <Segmented
                    labelledBy={ids.label}
                    value={typeof value === 'string' ? value : null}
                    disabled={disabled}
                    busy={busy === key}
                    invalid={failure !== null}
                    options={variable.options.map((option) => ({
                      value: option,
                      label: <UserContent translate="no">{variableWords(option)}</UserContent>,
                    }))}
                    onChange={(option) => void save(variable, option)}
                  />
                ) : variable.type === 'boolean' ? (
                  <Switch
                    aria-labelledby={ids.label}
                    checked={value === true}
                    disabled={disabled}
                    loading={busy === key}
                    invalid={failure !== null}
                    onCheckedChange={(on) => void save(variable, on)}
                  />
                ) : variable.type === 'colour' ? (
                  <ColourWell
                    id={ids.control}
                    describedBy={failure ? ids.problem : undefined}
                    value={typeof value === 'string' ? value : variable.default}
                    disabled={disabled}
                    busy={busy === key}
                    saved={saved === variable.name}
                    invalid={failure !== null}
                    onPick={(colour) => {
                      setSaved(null);
                      void save(variable, colour);
                    }}
                  />
                ) : (
                  <Input
                    id={ids.control}
                    value={drafts[variable.name] ?? ''}
                    inputMode={variable.type === 'number' ? 'decimal' : undefined}
                    maxLength={variable.type === 'text' ? variable.maxLength : undefined}
                    disabled={disabled}
                    readOnly={busy === key}
                    aria-busy={busy === key || undefined}
                    aria-describedby={failure ? ids.problem : undefined}
                    status={failure ? 'error' : saved === variable.name ? 'success' : undefined}
                    translate="no"
                    onChange={(event) => {
                      setSaved(null);
                      setDrafts((was) => ({ ...was, [variable.name]: event.target.value }));
                    }}
                    onBlur={() => commit(variable)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commit(variable);
                      }
                    }}
                  />
                )
              }
            </Field>
          );
        })}
      </div>
    </section>
  );
}

interface FieldIds {
  readonly label: string;
  readonly control: string;
  readonly problem: string;
}

/** A variable's name over its control, and the reason under it when something is wrong. */
function Field({
  name,
  problem,
  children,
}: {
  name: string;
  problem: string | null;
  children: (ids: FieldIds) => ReactNode;
}) {
  const ids: FieldIds = { label: useId(), control: useId(), problem: useId() };
  return (
    <div className="flex flex-col gap-1">
      <label id={ids.label} htmlFor={ids.control} className="text-xs font-semibold text-ink-2">
        <UserContent translate="no">{variableWords(name)}</UserContent>
      </label>
      {children(ids)}
      {problem ? (
        <p id={ids.problem} role="alert" className="m-0 text-xs text-danger-strong">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
