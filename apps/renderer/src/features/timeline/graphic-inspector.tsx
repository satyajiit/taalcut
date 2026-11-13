// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: graphics inspector (EDT1-GFX) · genre: atmospheric studio app (the timeline)
 * system: DESIGN.md v0.3 · the inspector for a selected motion graphic. HFW1 retire: every graphic is a design the
 *   AI made, so it is the designed graphic's inspector (design-inspector.tsx); this finds the selected one
 * states: the design's inspector · gone (the graphic left the timeline): one line
 * motion: none · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { TimelineItemId } from '@taalcut/core';
import { useMemo } from 'react';
import { DesignInspector } from './design-inspector';
import { useEditorContext } from './editor-context';
import { graphicView, graphicViewsOf } from './graphics-lane-model';
import type { EditorSelection } from './selection';

export interface GraphicInspectorProps {
  readonly itemId: TimelineItemId;
  readonly onSelect: (selection: EditorSelection) => void;
}

export function GraphicInspector({ itemId, onSelect }: GraphicInspectorProps) {
  const { t } = useLingui();
  const editor = useEditorContext();
  const timeline = editor?.timeline;
  const view = useMemo(
    () => (timeline ? graphicView(graphicViewsOf(timeline), itemId) : null),
    [timeline, itemId],
  );
  if (!editor || !timeline) return null;
  if (!view) return <p className="m-0 type-body text-ink-2">{t`The graphic isn’t on the timeline now.`}</p>;
  return <DesignInspector view={view} onSelect={onSelect} />;
}
