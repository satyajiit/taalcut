// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: export section "Captions" · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · Phase 2's two switches (burned into the video; a .srt file beside it) and the
 *   captions' language; a video without captions says so and "Add captions…" asks Taalcut in the chat.
 * states: default · no captions (the switches off, one line why, the ask) · hover/focus/active (switches, the
 *   button) · disabled (while the export starts) · loading/error/success: none of their own (the choices go
 *   with the export, which reports its own)
 * pre-emit critique: P5 H5 E5 S4 R5 V4
 */
import { useLingui } from '@lingui/react/macro';
import { LabelledSwitch } from '@taalcut/ui';
import { formatLanguage } from '../../shared/format';
import { AskRow, SectionFrame } from './section-frame';
import type { ExportSection, SectionProps } from './types';

function Captions({ context, choices, choose, ask, disabled }: SectionProps) {
  const { t, i18n } = useLingui();
  const captions = context.options.captions;
  const language = captions.language ? formatLanguage(i18n, captions.language) : null;
  return (
    <SectionFrame
      id="captions"
      title={t`Captions`}
      aside={
        captions.available && language ? (
          <span className="type-meta text-ink-2">{t`In ${language}`}</span>
        ) : null
      }
    >
      <div className="flex flex-col gap-2.5">
        <LabelledSwitch
          checked={captions.available && choices.burnIn}
          disabled={disabled || !captions.available}
          onChange={(burnIn) => choose({ burnIn })}
        >
          {t`Burn the captions into the video`}
        </LabelledSwitch>
        <LabelledSwitch
          checked={captions.available && choices.srt}
          disabled={disabled || !captions.available}
          onChange={(srt) => choose({ srt })}
        >
          {t`Also save a subtitle file (.srt)`}
        </LabelledSwitch>
      </div>
      {captions.available ? null : (
        <AskRow
          label={t`This video has no captions. Ask Taalcut to add them.`}
          note={t`From what’s said in the clips, timed to the words.`}
          action={t`Add captions…`}
          disabled={disabled}
          onAsk={() => ask(t`Add captions to this video.`)}
        />
      )}
    </SectionFrame>
  );
}

export const captionsSection: ExportSection = { id: 'captions', available: () => true, Component: Captions };
