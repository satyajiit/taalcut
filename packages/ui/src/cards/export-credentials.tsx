// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: the export card's AI label (P3-V7) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · inside the exportApproval card, under the captions: one switch, "Add Content
 *   Credentials (C2PA)", off unless a person turns it on (render.setContentCredentials; the agent can't), a note
 *   under it (off with signed sources: how many and that they aren't kept; on: the test certificate), and when a
 *   model made part of the video, how each app asks you to label it, one hairline row per app (the AI mark leads)
 * states: default (off) · on · off with signed sources · hover/focus/active (the switch, the rows) · disabled (the
 *   card settled or exporting) · loading (the switch while it saves) · error (the cause in one line; the switch
 *   goes back) · success (silent: the switch moved)
 * motion: a reminder row's chevron turns over --dur-micro; nothing else moves
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { ExportCredentials, Platform, ProjectId, TaalcutError } from '@taalcut/core';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { AiMark } from '#components/ai-mark';
import { cn } from '#lib/cn';
import { errorMessage } from '../feedback/error-messages';
import { disclosureText } from '../make/render-words';
import { LabelledSwitch } from '../make/switch';
import { useCardActions } from './card-actions';

function Reminder({ platform, open: initiallyOpen }: { platform: Platform; open: boolean }) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(initiallyOpen);
  const steps = useId();
  return (
    <li data-platform={platform} className="border-b border-rule-subtle last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={steps}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-8 w-full items-center justify-between gap-2 rounded-sm px-1 py-1 text-start text-sm text-ink hover:bg-hover active:bg-pressed"
      >
        {disclosureText(i18n, platform, 'title')}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-micro) ease-(--ease-out)',
            open && 'rotate-180',
          )}
        />
      </button>
      <p id={steps} hidden={!open} className="m-0 px-1 pb-2 text-xs leading-relaxed text-ink-2">
        {disclosureText(i18n, platform, 'steps')}
      </p>
    </li>
  );
}

export interface ExportCredentialsFieldProps {
  projectId: ProjectId;
  credentials: ExportCredentials;
  /** The export's app, whose reminder opens first. */
  platform: Platform | null;
  disabled: boolean;
}

export function ExportCredentialsField({
  projectId,
  credentials,
  platform,
  disabled,
}: ExportCredentialsFieldProps) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const [add, setAdd] = useState(credentials.add);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  useEffect(() => setAdd(credentials.add), [credentials.add]);

  const toggle = async (next: boolean) => {
    if (!actions.dispatch) return;
    setAdd(next);
    setSaving(true);
    setError(null);
    const result = await actions.dispatch('render.setContentCredentials', { projectId, add: next });
    setSaving(false);
    if (!result.ok) {
      setAdd(!next);
      setError(result.error);
    }
  };
  const signed = credentials.sourcesWithCredentials;
  return (
    <div data-slot="export-credentials" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <LabelledSwitch
          checked={add}
          loading={saving}
          disabled={disabled || !actions.dispatch}
          onChange={(next) => void toggle(next)}
        >
          {t`Add Content Credentials (C2PA)`}
        </LabelledSwitch>
        <p className="m-0 ps-11 text-xs text-ink-2">
          {add
            ? t`Signed with a test certificate: apps will show the issuer as not recognised.`
            : signed > 0
              ? i18n._(
                  msg`${plural(signed, {
                    one: '# part carries Content Credentials from its maker. Turn this on to carry them into the video; otherwise they aren’t kept.',
                    other:
                      '# parts carry Content Credentials from their makers. Turn this on to carry them into the video; otherwise they aren’t kept.',
                  })}`,
                )
              : t`A signed note in the file that says how it was made, AI parts included. Off: nothing is added.`}
        </p>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm text-danger-strong">
          {errorMessage(i18n, error)}
        </p>
      ) : null}
      {credentials.disclosures.length > 0 ? (
        <div data-slot="disclosures" className="flex flex-col gap-1">
          <p className="m-0 flex items-start gap-2 text-sm text-ink">
            <AiMark className="mt-0.5 size-4" />
            {t`Parts of this video were made with AI. Each app asks you to say so when you post:`}
          </p>
          <ul className="m-0 flex list-none flex-col p-0">
            {credentials.disclosures.map((each, index) => (
              <Reminder
                key={each}
                platform={each}
                open={platform === null ? index === 0 : each === platform}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
