// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: opening choice, the open way's panel · genre: atmospheric studio app (chrome modern-minimal)
 * · system: DESIGN.md v0.3
 * what opens under a way that needs more before it starts: the reel field, the template list (first run: the starter
 *   grid, P3-B3), the description, add a folder; each sends the chat its sentence through the choices' one start
 * states: the panels' own (opening-reel, opening-templates, opening-starters, opening-describe, opening-library)
 */
import { useLingui } from '@lingui/react/macro';
import type { ChatStart, OpeningPath, TaalcutError } from '@taalcut/core';
import { useEffect, useRef, useState } from 'react';
import { OPENING_MESSAGES, openingReason, PARTIAL_REASONS } from './flow-labels';
import { OpeningDescribe } from './opening-describe';
import { OpeningLibrary } from './opening-library';
import { OpeningReel } from './opening-reel';
import { OpeningStarters, useStartStarter } from './opening-starters';
import { OpeningTemplates } from './opening-templates';

/** Starts a flow from a way; the error, if any, comes back to the panel that asked. */
export type BeginFlow = (path: OpeningPath, start: ChatStart, text: string) => Promise<TaalcutError | null>;

/** Which way's panel is open; each change is reported once (first run keeps it for a resume). */
export function useOpenPanel(
  initialOpen: OpeningPath | null,
  onOpenChange: ((path: OpeningPath | null) => void) | undefined,
) {
  const [open, setOpen] = useState<OpeningPath | null>(initialOpen);
  const reported = useRef<OpeningPath | null>(initialOpen);
  useEffect(() => {
    if (open === reported.current) return;
    reported.current = open;
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  return [open, setOpen] as const;
}

export interface OpeningPanelProps {
  path: OpeningPath;
  busy: boolean;
  /** Why the way is off, if it is: off only in part (Paste a reel under Local only), its link field says so. */
  reason: string | undefined;
  /** First run: the template way opens the starter grid. */
  starters: boolean;
  begin: BeginFlow;
  /** No templates yet: the reel way instead. */
  onNone: () => void;
}

/**
 * The panel under an open way, in its own full-width row of the tiles' grid. The forms take 4 px more on each side
 * so their own 12 px padding lines their words up with the tiles' (16 px); the starter grid's tiles run edge to edge
 * with the choice tiles.
 */
export function OpeningPanel(props: OpeningPanelProps) {
  if (props.path === 'template' && props.starters) return <OpeningStarters disabled={props.busy} />;
  return (
    <div className="px-1">
      <PanelBody {...props} />
    </div>
  );
}

function PanelBody({ path, busy, reason, begin, onNone }: OpeningPanelProps) {
  const { t, i18n } = useLingui();
  if (path === 'reference')
    return (
      <OpeningReel
        disabled={busy}
        linkOff={reason && PARTIAL_REASONS.has(reason) ? openingReason(i18n, reason) : undefined}
        onStart={(reference, label) =>
          begin('reference', { path: 'reference', reference }, t`Make a video like this reel: ${label}`)
        }
      />
    );
  if (path === 'template') return <TemplatePanel busy={busy} begin={begin} onNone={onNone} />;
  if (path === 'describe')
    return (
      <OpeningDescribe disabled={busy} onStart={(text) => begin('describe', { path: 'describe' }, text)} />
    );
  return (
    <OpeningLibrary
      disabled={busy}
      onAdded={() => begin('library', { path: 'library' }, i18n._(OPENING_MESSAGES.library))}
    />
  );
}

/** The template way in a chat: a saved template, a starter (forked first) or a format, each with its sentence. */
function TemplatePanel({ busy, begin, onNone }: Pick<OpeningPanelProps, 'busy' | 'begin' | 'onNone'>) {
  const { t } = useLingui();
  const startStarter = useStartStarter((templateId, text) =>
    begin('template', { path: 'template', templateId }, text),
  );
  return (
    <OpeningTemplates
      disabled={busy}
      onNone={onNone}
      onPick={(choice) => {
        const name = choice.name;
        if (choice.kind === 'starter') return startStarter(choice);
        return choice.kind === 'template'
          ? begin(
              'template',
              { path: 'template', templateId: choice.id },
              t`Make a video with my template “${name}”`,
            )
          : begin(
              'template',
              { path: 'describe', formatId: choice.id },
              t`Make a video in the ${name} format`,
            );
      }}
    />
  );
}
