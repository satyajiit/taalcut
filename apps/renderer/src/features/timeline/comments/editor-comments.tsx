// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: editor comments · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * the editor's comment wiring, mounted once in the editor: C comments on what is selected (or the clip under the
 *   playhead, at that moment), a right-click (or the menu key) on an item of the bed offers Comment…, a comment
 *   picked in the dock puts the playhead on it and brings it into view, and the composer opens over the editor
 * states: the composer's and the menu's own · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { editTargetFrame, editTargetSpan, type EditTarget } from '@taalcut/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  VERB_ICONS,
} from '@taalcut/ui';
import { useEffect, useEffectEvent, useState } from 'react';
import { currentSelection } from '../../../chat/selection-store';
import { useEditorContext } from '../editor-context';
import { CommentComposer } from './comment-composer';
import { commentOn, goToCommentRequests, useClaim } from './comment-requests';
import { elementTarget, newCommentOn } from './comment-targets';

/** Fields, menus, dialogs and the dock keep their own keys (as use-editor-keys.ts). */
const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const ELSEWHERE = '[data-slot=editor-dock], [role=dialog], [role=menu], [role=listbox][data-slot=palette]';

export function EditorComments() {
  const editor = useEditorContext();
  const [menu, setMenu] = useState<{ x: number; y: number; target: EditTarget } | null>(null);

  // C: a comment on what is selected, or on the clip under the playhead.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!editor || event.defaultPrevented || event.isComposing) return;
    if (event.key !== 'c' && event.key !== 'C') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(TYPING) || target?.closest(ELSEWHERE)) return;
    event.preventDefault();
    commentOn(newCommentOn(editor.timeline, currentSelection(), editor.playhead.frame()));
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // A right-click, or the menu key on a focused item, offers Comment… on that item.
  const onContextMenu = useEffectEvent((event: MouseEvent) => {
    if (!editor) return;
    const element = event.target instanceof Element ? event.target : null;
    const target = elementTarget(element, editor.timeline);
    if (!target) return;
    event.preventDefault();
    const box = element?.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0 && box;
    setMenu({ x: keyboard ? box.left : event.clientX, y: keyboard ? box.bottom : event.clientY, target });
  });
  const scroller = editor?.scroller.current ?? null;
  useEffect(() => {
    if (!scroller) return;
    const listener = (event: MouseEvent) => onContextMenu(event);
    scroller.addEventListener('contextmenu', listener);
    return () => scroller.removeEventListener('contextmenu', listener);
  }, [scroller]);

  // A comment picked in the dock or on the bed: the editor selects what it is on (ctx's `select`), with the playhead
  // on its moment, and brings it into view.
  useClaim(goToCommentRequests, (comment) => {
    if (!editor || comment.timelineId !== editor.timeline.id) return;
    const frame = editTargetFrame(editor.timeline, comment.anchor, comment.at);
    const { num, den } = editor.timeline.canvas.rate;
    editor.select(
      comment.anchor.kind === 'timeline' ? null : comment.anchor,
      frame === null ? null : (frame * den) / num,
    );
  });

  if (!editor) return null;
  return (
    <>
      <CommentComposer timeline={editor.timeline} />
      {menu ? <ItemMenu {...menu} onClose={() => setMenu(null)} /> : null}
    </>
  );
}

function ItemMenu({
  x,
  y,
  target,
  onClose,
}: {
  x: number;
  y: number;
  target: EditTarget;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const editor = useEditorContext();
  return (
    <DropdownMenu open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: x, top: y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-slot="item-comment-menu">
        <DropdownMenuItem
          onSelect={() => {
            onClose();
            if (!editor) return;
            // At the playhead, when it is inside the item.
            const span = editTargetSpan(editor.timeline, target);
            const frame = editor.playhead.frame();
            commentOn(
              span && frame >= span.start && frame < span.end
                ? { target, at: frame - span.start }
                : { target },
            );
          }}
        >
          <VERB_ICONS.comment aria-hidden />
          {t`Comment…`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
