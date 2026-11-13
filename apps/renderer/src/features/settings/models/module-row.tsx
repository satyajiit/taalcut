// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: module-row · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a job's model and thinking level with SVGL ProviderLogo badges and studio Select controls;
 * with Local only on, the job's quality label beside its name (P3-B10: simpler on this Mac, or off)
 * UX3-AGT: Thinking lists exactly the model's levels under its provider's names (the composer's, from the kit)
 * states: default · hover · focus · active · disabled (busy)
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  REASONING_LEVELS,
  type ReasoningLevel,
  type ModelOption,
  type ModuleOverride,
  type ModuleQuality,
  type ModuleState,
} from '@taalcut/core';
import { Badge, Button, Chip, nearestThinkingLevel, ProviderLogo, thinkingLevelName } from '@taalcut/ui';
import { useId } from 'react';
import { Field, Select } from '../fields';
import { translateKey } from '../model-messages';
import { QualityChip } from '../privacy/quality-labels';
import { providerName } from '../providers';
import { choiceKey, modelName, type OptionsByModule } from './model-options';

const UNAVAILABLE: Record<NonNullable<ModelOption['unavailable']>, MessageDescriptor> = {
  'needs-higher-tier': msg`needs a faster Mac`,
  'not-configured': msg`add a key first`,
  'not-installed': msg`not downloaded yet`,
  retired: msg`retired`,
};

const MODULE_FALLBACK = msg`Another job`;

export interface ModuleRowProps {
  module: ModuleState;
  /** Local only's effect on this job, when it has one (simpler here, or off). */
  quality?: ModuleQuality | undefined;
  options: OptionsByModule | undefined;
  busy: boolean;
  onOverride: (override: ModuleOverride) => void;
  onReset: () => void;
}

/** One job (module) in Advanced: its model, its thinking level, provider logo, and where it falls back to. */
export function ModuleRow({ module, quality, options, busy, onOverride, onReset }: ModuleRowProps) {
  const { t, i18n } = useLingui();
  const id = useId();
  const label = translateKey(i18n, module.labelKey, MODULE_FALLBACK);
  const list = options?.[module.module] ?? [];
  const [primary, ...fallbacks] = module.chain;
  const selected = primary ? list.find((o) => choiceKey(o) === choiceKey(primary)) : undefined;
  const showReasoning = module.reasoning && primary !== undefined && (selected?.reasoning ?? true);
  // The model's own levels (a model the list doesn't know takes any; the provider clamps it).
  const levels = selected?.thinking ?? REASONING_LEVELS;
  const level = nearestThinkingLevel(primary?.reasoning ?? 'off', levels);

  function choose(key: string) {
    const option = list.find((o) => choiceKey(o) === key);
    if (!option) return;
    // Keep the thinking level the job has now, as the nearest the new model has (UX3-AGT).
    const kept = module.override?.reasoning ?? primary?.reasoning;
    const reasoning = kept && option.thinking ? nearestThinkingLevel(kept, option.thinking) : kept;
    onOverride({
      ...module.override,
      primary: { provider: option.provider, model: option.model },
      ...(reasoning ? { reasoning } : {}),
    });
  }

  const optionText = (o: ModelOption) => {
    const notes = [
      ...(o.local ? [t`on this Mac`] : []),
      ...(o.noteKey ? [translateKey(i18n, o.noteKey, msg`note`)] : []),
      ...(o.unavailable ? [i18n._(UNAVAILABLE[o.unavailable])] : []),
    ];
    if (notes.length === 0) return o.name;
    const name = o.name;
    const noteList = formatList(notes);
    return t`${name} (${noteList})`;
  };
  const formatList = (items: string[]) => new Intl.ListFormat(i18n.locale, { type: 'unit' }).format(items);
  const fallbackNames = formatList(fallbacks.map((c) => modelName(options, c)));
  const activeProviderName = primary ? (providerName(i18n, primary.provider) ?? primary.provider) : null;

  return (
    <li className="border-t border-rule-subtle first:border-t-0">
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3.5 px-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-title`} className="m-0 type-card-title text-ink">
              {label}
            </h3>
            {module.override ? (
              <Chip tone="you" className="whitespace-normal">
                <Trans>You changed this</Trans>
              </Chip>
            ) : null}
            {quality ? <QualityChip quality={quality} /> : null}
          </div>
          <p className="m-0 type-meta text-ink-2">
            {translateKey(i18n, module.descriptionKey, MODULE_FALLBACK)}
          </p>
        </div>
        {primary && activeProviderName ? (
          <Badge tone="neutral" className="gap-1.5 py-0.5 pr-2.5 pl-1.5">
            <ProviderLogo provider={primary.provider} size="xs" framed={false} />
            <span translate="no">{activeProviderName}</span>
          </Badge>
        ) : null}
      </div>

      {primary === undefined ? (
        <p className="m-0 type-meta text-ink-3">
          <Trans>Off in this profile. Pick another profile to use it.</Trans>
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={<Trans>Model</Trans>} htmlFor={`${id}-model`} className="min-w-56 flex-[2_1_14rem]">
            <Select
              id={`${id}-model`}
              value={choiceKey(primary)}
              disabled={busy}
              leading={<ProviderLogo provider={primary.provider} size="xs" framed={false} />}
              onChange={(event) => choose(event.target.value)}
            >
              {selected ? null : (
                <option value={choiceKey(primary)} translate="no">
                  {primary.model}
                </option>
              )}
              {list.map((o) => (
                <option
                  key={choiceKey(o)}
                  value={choiceKey(o)}
                  disabled={o.unavailable !== undefined}
                  translate="no"
                >
                  {optionText(o)}
                </option>
              ))}
            </Select>
          </Field>
          {showReasoning ? (
            <Field
              label={<Trans>Thinking</Trans>}
              htmlFor={`${id}-reasoning`}
              className="min-w-36 flex-[1_1_9rem]"
            >
              <Select
                id={`${id}-reasoning`}
                value={level}
                disabled={busy}
                onChange={(event) =>
                  onOverride({ ...module.override, reasoning: event.target.value as ReasoningLevel })
                }
              >
                {levels.map((each) => (
                  <option key={each} value={each}>
                    {i18n._(thinkingLevelName(each, primary))}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {module.override ? (
            <Button variant="ghost" size="md" disabled={busy} onClick={onReset}>
              <Trans>Use the profile’s choice</Trans>
            </Button>
          ) : null}
        </div>
      )}

      {fallbacks.length > 0 ? (
        <p className="m-0 type-meta text-ink-3">
          <Trans>
            If it’s busy or down: <span translate="no">{fallbackNames}</span>
          </Trans>
        </p>
      ) : null}
      {module.skipped.map((skip) => {
        const skippedName = modelName(options, skip.choice);
        return (
          <p key={`${skip.reason}-${choiceKey(skip.choice)}`} className="m-0 type-meta text-ink-3">
            {skip.reason === 'needs-higher-tier' ? (
              <Trans>
                Skipped <span translate="no">{skippedName}</span>: it needs a faster Mac.
              </Trans>
            ) : (
              <Trans>
                <span translate="no">{skippedName}</span> is retired, so it isn’t used.
              </Trans>
            )}
          </p>
        );
      })}
    </section>
    </li>
  );
}
