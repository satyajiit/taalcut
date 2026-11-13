// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: transition marks (EDT1-OPS) · system: DESIGN.md v0.6
 * over the clips, each transition where two clips meet: a small bow tie as long as the overlap (two triangles
 *   meeting at the cut), named in words for assistive tech ("Crossfade between clips 3 and 4"); a plain cut has none
 * states: n/a (not interactive: the clip before it sets it in the inspector) · empty (no transitions: nothing) */
import { useLingui } from '@lingui/react/macro';
import { TRANSITION_WORDS } from './clip-edit-controls';
import { useEditorContext } from './editor-context';

export function TransitionMarks({ pxPerFrame }: { readonly pxPerFrame: number }) {
  const { t, i18n } = useLingui();
  const editor = useEditorContext();
  if (!editor || editor.model.transitions.length === 0) return null;
  const { model } = editor;
  return (
    <div
      role="list"
      aria-label={t`Transitions`}
      className="pointer-events-none absolute inset-x-0 top-1 h-16"
    >
      {model.transitions.map(({ item, at }) => {
        const before = model.clips.findLast((clip) => clip.end <= at + 1);
        const a = i18n.number(before?.number ?? 0);
        const b = i18n.number((before?.number ?? 0) + 1);
        const words =
          item.kind in TRANSITION_WORDS
            ? i18n._(TRANSITION_WORDS[item.kind as keyof typeof TRANSITION_WORDS])
            : t`A transition`;
        const name = t`${words} between clips ${a} and ${b}`;
        const left = (at - item.inOffset.value) * pxPerFrame;
        const width = Math.max(8, (item.inOffset.value + item.outOffset.value) * pxPerFrame);
        return (
          <span
            key={item.id}
            role="listitem"
            aria-label={name}
            title={name}
            data-slot="timeline-transition"
            data-kind={item.kind}
            className="absolute top-1/2 h-3 -translate-y-1/2 bg-ink/70 [clip-path:polygon(0_0,50%_50%,100%_0,100%_100%,50%_50%,0_100%)]"
            style={{ left, width }}
          />
        );
      })}
    </div>
  );
}
