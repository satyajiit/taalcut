// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: export section "AI label" · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · one switch, "Add Content Credentials (C2PA)", off by default (render's option: off adds
 *   nothing to the file); a person turns it on (render.setContentCredentials refuses the agent). Off with signed
 *   sources: how many parts carry their makers' credentials and that they aren't kept. On: the test certificate,
 *   said plainly. Whenever a model made part of the video, on or off: how each app asks you to label it when you
 *   post (Disclosures; the chosen app's open first).
 * states: default (off) · on (the certificate line) · off with signed sources (the "not kept" line) · hover/
 *   focus/active (the switch, the reminders' rows) · disabled (while the export starts) · loading (the switch while
 *   it saves) · error (the cause in one line; the switch stays where it was) · success (silent: the switch moved)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
import { msg, plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { RENDER_COMMANDS, type TaalcutError } from '@taalcut/core';
import { ErrorLine, LabelledSwitch } from '@taalcut/ui';
import { useState } from 'react';
import { Disclosures } from './disclosures';
import { SectionFrame, SectionNote } from './section-frame';
import type { ExportSection, SectionProps } from './types';

function AiLabel({ context, choices, dispatch, reload, disabled }: SectionProps) {
  const { t, i18n } = useLingui();
  const { options, projectId } = context;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const credentials = options.credentials;
  if (!credentials) return null;
  const platform =
    options.presets.find((entry) => entry.preset.id === choices.presetId)?.preset.platform ?? null;

  const toggle = async (add: boolean) => {
    setSaving(true);
    setError(null);
    const result = await dispatch(RENDER_COMMANDS.setContentCredentials, { projectId, add });
    setSaving(false);
    if (result.ok) reload();
    else setError(result.error);
  };
  const signed = credentials.sourcesWithCredentials;
  return (
    <SectionFrame id="aiLabel" title={t`AI label`}>
      <div className="flex flex-col gap-1">
        <LabelledSwitch
          checked={credentials.add}
          disabled={disabled}
          loading={saving}
          onChange={(add) => void toggle(add)}
        >
          {t`Add Content Credentials (C2PA)`}
        </LabelledSwitch>
        <SectionNote className="ps-11">
          {credentials.add
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
        </SectionNote>
      </div>
      {error ? <ErrorLine error={error} /> : null}
      {credentials.disclosures.length > 0 ? (
        <Disclosures platforms={credentials.disclosures} open={platform} />
      ) : null}
    </SectionFrame>
  );
}

export const aiLabelSection: ExportSection = {
  id: 'aiLabel',
  available: ({ options }) => options.credentials !== undefined,
  Component: AiLabel,
};
