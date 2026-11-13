// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: help improve Taalcut · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · two switch rows (telemetry with its alpha code, crash reports), both off by default
 * states: the switch row's eight; the code field: default · hover · focus · disabled (telemetry off or Local
 *   only) · loading (Save spins) · error (the format line, aria-invalid) · success (the code shows as saved) */

import { Trans, useLingui } from '@lingui/react/macro';
import { COHORT_CODE_PATTERN, PRIVACY_COMMANDS } from '@taalcut/core';
import { Button, Input } from '@taalcut/ui';
import { useId, useState, type FormEvent } from 'react';
import { SettingRows } from '../rows';
import { SwitchRow } from '../switch-row';
import type { usePersonCommand } from './use-person-command';

export interface HelpImproveProps {
  localOnly: boolean;
  telemetry: { enabled: boolean; cohort?: string | undefined };
  crashReports: boolean;
  person: ReturnType<typeof usePersonCommand>;
  /** After a write: the telemetry state is read again. */
  onChanged: () => void;
  /** The alpha's test-group code under usage counts; off on the public beta's first run (P3-B14). */
  cohortField?: boolean;
}

/** The six-character alpha code the product owner gave you, kept with telemetry (optional). */
export function AlphaCodeField({
  cohort,
  disabled,
  busy,
  onSave,
}: {
  cohort: string | undefined;
  disabled: boolean;
  busy: boolean;
  onSave: (code: string) => void;
}) {
  const { t } = useLingui();
  const field = useId();
  const help = useId();
  const [value, setValue] = useState(cohort ?? '');
  const [wrong, setWrong] = useState(false);
  const code = value.trim().toUpperCase();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!COHORT_CODE_PATTERN.test(code)) return setWrong(true);
    setWrong(false);
    onSave(code);
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-1.5">
      <label htmlFor={field} className="type-label text-ink">
        <Trans>Alpha code (optional)</Trans>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={field}
          value={value}
          maxLength={6}
          autoComplete="off"
          spellCheck={false}
          translate="no"
          disabled={disabled}
          status={wrong ? 'error' : undefined}
          aria-describedby={help}
          onChange={(event) => {
            setValue(event.target.value.toUpperCase());
            if (wrong) setWrong(false);
          }}
          className="w-28 font-mono tracking-widest uppercase"
        />
        <Button
          type="submit"
          size="sm"
          loading={busy}
          disabled={disabled || code === (cohort ?? '') || code.length === 0}
        >
          <Trans>Save code</Trans>
        </Button>
      </div>
      <p
        id={help}
        role={wrong ? 'alert' : undefined}
        className={wrong ? 'm-0 type-meta text-danger-strong' : 'm-0 type-meta text-ink-3'}
      >
        {wrong
          ? t`The code is six letters and numbers, like K7Q2MX.`
          : cohort
            ? t`Saved. Your events are grouped with the other testers who have it.`
            : t`If you were given one, it groups your events with your test group’s.`}
      </p>
    </form>
  );
}

/** Where Privacy's Help improve rows sit: About's crash-report line links here (P3-B14). */
export const HELP_IMPROVE_ANCHOR = 'help-improve';

/** Help improve Taalcut: consented telemetry and crash reports (P2-X2, P2-X7). Both start off. */
export function HelpImprove({
  localOnly,
  telemetry,
  crashReports,
  person,
  onChanged,
  cohortField = true,
}: HelpImproveProps) {
  const { t } = useLingui();
  const paused = localOnly ? t`Paused while Local only is on.` : null;
  const setTelemetry = async (key: string, enabled: boolean, cohort?: string) => {
    const payload = { enabled, ...(cohort ? { cohort } : {}) };
    if (await person.run(key, PRIVACY_COMMANDS.setTelemetry, payload)) onChanged();
  };
  return (
    <SettingRows aria-label={t`Help improve Taalcut`}>
      <SwitchRow
        as="li"
        data-setting="telemetry"
        label={<Trans>Share usage counts</Trans>}
        description={
          paused ?? (
            <Trans>
              Counts and timings, like how long an import took or whether a check passed. Never your clips,
              words or file names.
            </Trans>
          )
        }
        checked={telemetry.enabled}
        disabled={localOnly || (person.anyBusy && !person.busy('telemetry'))}
        busy={person.busy('telemetry')}
        error={person.error('telemetry') ?? person.error('cohort')}
        onChange={(enabled) => void setTelemetry('telemetry', enabled, telemetry.cohort)}
      >
        {telemetry.enabled && cohortField ? (
          <AlphaCodeField
            cohort={telemetry.cohort}
            disabled={localOnly || (person.anyBusy && !person.busy('cohort'))}
            busy={person.busy('cohort')}
            onSave={(code) => void setTelemetry('cohort', true, code)}
          />
        ) : null}
      </SwitchRow>
      <SwitchRow
        as="li"
        data-setting="crash-reports"
        label={<Trans>Send crash reports</Trans>}
        description={
          paused ?? (
            <Trans>
              When Taalcut crashes: the error and where in the code it happened, the app and macOS versions,
              and your Mac’s chip. Paths and the names of you and your Mac are removed. No memory dumps, never
              your media. Starts from the next launch.
            </Trans>
          )
        }
        checked={crashReports}
        disabled={localOnly || (person.anyBusy && !person.busy('crash-reports'))}
        busy={person.busy('crash-reports')}
        error={person.error('crash-reports')}
        onChange={(enabled) =>
          void person.run('crash-reports', PRIVACY_COMMANDS.setCrashReports, { enabled }).then((done) => {
            if (done) onChanged();
          })
        }
      />
    </SettingRows>
  );
}
