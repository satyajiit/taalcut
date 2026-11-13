// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the editor's edit tools (UX4) · system: DESIGN.md v0.6 + UX4 (icon registry)
 * in the transport, so they stay on screen at 1280×800 whatever the inspector holds: Undo and Redo (the project's
 *   history, the same one ⌘Z uses), then the selected clip's trims, a beat shorter and a beat longer. Icon buttons,
 *   each named and with its tooltip (what it does, the thing it would undo, its keys); a hairline parts the two
 *   groups. Ghost buttons: the screen's one marigold fill stays Export…
 * states: the kit's Button (default, hover, focus-visible, active: gives by 2 %, loading while the command is on
 *   its way) · disabled (nothing to undo or redo; no clip selected; a locked clip; a clip that can't get shorter)
 *   · the tooltip on hover and keyboard focus
 */
import { useLingui } from '@lingui/react/macro';
import { MIN_CLIP_FRAMES, type ProjectId } from '@taalcut/core';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useShortcutFormat,
  VERB_ICONS,
  type IconLike,
} from '@taalcut/ui';
import { Scissors } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';
import { commandLabel } from '../../recovery/labels';
import { editorOps } from './edit-ops';
import { useEditorContext } from './editor-context';
import { ACCELERATORS, KEYS } from './keys';
import { clipAt, type ClipView, type TimelineModel } from './model';
import type { Edits } from './use-edits';
import { useProjectUndo } from './use-project-undo';

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
// A slider keeps its own keys (a pacing band's S splits the band).
const ELSEWHERE =
  '[data-slot=editor-dock], [role=dialog], [role=menu], [role=slider], [role=listbox][data-slot=palette]';

/**
 * EDT1-OPS: S splits the clip at the playhead, ⌫ (or Delete) takes the selected clip out and closes up, wherever
 * the focus is on the page but a field, the docked chat, a dialog or a menu.
 */
function useSplitDeleteKeys(split: () => void, remove: () => void) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(TYPING) || target?.closest(ELSEWHERE)) return;
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      split();
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      remove();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}

function Tool({
  label,
  tip,
  keys,
  ariaKeys,
  icon,
  slot,
  disabled,
  loading,
  onClick,
}: {
  label: string;
  /** The tooltip's words, where they say more than the name. */
  tip?: string;
  keys?: string;
  ariaKeys?: string;
  icon: IconLike;
  slot: string;
  disabled: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 disabled:border-transparent disabled:bg-transparent"
          aria-label={label}
          {...(ariaKeys ? { 'aria-keyshortcuts': ariaKeys } : {})}
          data-slot={slot}
          icon={icon}
          disabled={disabled}
          loading={loading}
          onClick={onClick}
        />
      </TooltipTrigger>
      <TooltipContent>
        {tip ?? label}
        {keys ? <kbd className="ms-2 font-sans text-on-tooltip">{keys}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export interface EditToolsProps {
  projectId: ProjectId;
  model: TimelineModel;
  /** The selected clip, if a clip is what's selected. */
  clip: ClipView | undefined;
  edits: Edits;
  detailed?: boolean;
}

export function EditTools({ projectId, model, clip, edits, detailed = true }: EditToolsProps) {
  const { t, i18n } = useLingui();
  const shortcut = useShortcutFormat();
  const history = useProjectUndo(projectId);
  const [trimming, setTrimming] = useState<'shorter' | 'longer' | null>(null);
  const beat = model.beatFrames;
  const locked = clip?.item.locked ?? false;
  const canShorten = !!clip && !locked && clip.end - clip.start - beat >= MIN_CLIP_FRAMES;
  const undoWhat = history.undo ? commandLabel(i18n, history.undo) : null;
  const redoWhat = history.redo ? commandLabel(i18n, history.redo) : null;
  const trim = async (which: 'shorter' | 'longer') => {
    if (!clip || edits.pending) return;
    setTrimming(which);
    try {
      await edits.trim(clip.item.id, 'end', which === 'longer' ? beat : -beat);
    } finally {
      setTrimming(null);
    }
  };
  // EDT1-OPS: split at the playhead (the clip playing there), delete the selected clip.
  const editor = useEditorContext();
  const ops = editorOps(edits, model.rate);
  const [cutting, setCutting] = useState<'split' | 'remove' | null>(null);
  const split = async () => {
    const frame = editor?.playhead.frame() ?? 0;
    const under = clipAt(model, frame);
    if (
      edits.pending ||
      !under ||
      under.item.locked ||
      frame - under.start < MIN_CLIP_FRAMES ||
      under.end - frame < MIN_CLIP_FRAMES
    )
      return;
    setCutting('split');
    try {
      await ops.split(under.item.id, frame);
    } finally {
      setCutting(null);
    }
  };
  const remove = async () => {
    if (edits.pending || !clip || locked || model.clips.length < 2) return;
    setCutting('remove');
    try {
      await ops.remove(clip.item.id);
    } finally {
      setCutting(null);
    }
  };
  useSplitDeleteKeys(
    () => void split(),
    () => void remove(),
  );
  return (
    <div role="group" aria-label={t`Edit`} data-slot="edit-tools" className="flex items-center gap-0.5">
      <Tool
        slot="undo"
        label={t`Undo`}
        {...(history.undoTurn
          ? { tip: t`Undo the chat’s change` }
          : undoWhat
            ? { tip: t`Undo “${undoWhat}”` }
            : {})}
        keys={shortcut.text(ACCELERATORS.undo)}
        ariaKeys={shortcut.aria(ACCELERATORS.undo)}
        icon={VERB_ICONS.undo}
        disabled={edits.pending || !history.undo}
        loading={history.busy === 'undo'}
        onClick={() => void history.run('undo')}
      />
      <Tool
        slot="redo"
        label={t`Redo`}
        {...(history.redoTurn
          ? { tip: t`Redo the chat’s change` }
          : redoWhat
            ? { tip: t`Redo “${redoWhat}”` }
            : {})}
        keys={shortcut.text(ACCELERATORS.redo)}
        ariaKeys={shortcut.aria(ACCELERATORS.redo)}
        icon={VERB_ICONS.redo}
        disabled={edits.pending || !history.redo}
        loading={history.busy === 'redo'}
        onClick={() => void history.run('redo')}
      />
      {detailed ? (
        <>
          <span aria-hidden className="mx-1.5 h-4 w-px bg-rule" />
          {/* Fold and unfold: the clip's end moves in or out by one beat. */}
          <Tool
            slot="trim-shorter"
            label={t`A beat shorter`}
            keys={KEYS.shorter}
            ariaKeys={KEYS.shorter}
            icon={VERB_ICONS.shorter}
            disabled={edits.pending || !canShorten}
            loading={trimming === 'shorter'}
            onClick={() => void trim('shorter')}
          />
          <Tool
            slot="trim-longer"
            label={t`A beat longer`}
            keys={KEYS.longer}
            ariaKeys={KEYS.longer}
            icon={VERB_ICONS.longer}
            disabled={edits.pending || !clip || locked}
            loading={trimming === 'longer'}
            onClick={() => void trim('longer')}
          />
          <span aria-hidden className="mx-1.5 h-4 w-px bg-rule" />
          <Tool
            slot="split"
            label={t`Split at the playhead`}
            keys="S"
            ariaKeys={KEYS.split}
            icon={Scissors}
            disabled={edits.pending || model.clips.length === 0}
            loading={cutting === 'split'}
            onClick={() => void split()}
          />
          <Tool
            slot="delete-clip"
            label={t`Delete this clip`}
            tip={t`Delete this clip; what follows closes up`}
            keys="⌫"
            ariaKeys={KEYS.remove}
            icon={VERB_ICONS.delete}
            disabled={edits.pending || !clip || locked || model.clips.length < 2}
            loading={cutting === 'remove'}
            onClick={() => void remove()}
          />
        </>
      ) : null}
    </div>
  );
}
