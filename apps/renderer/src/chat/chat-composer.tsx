// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: chat composer (wiring) · system: DESIGN.md v0.2 · the kit's Composer with
 * the agent's model (global, Settings' command) and this chat's thinking level, the chips the
 * message will carry (the kit's SelectionTray, inside the bar; docked, the editor's selection first,
 * EDT1) and the recipes that fit what is on screen (P3-V11, the Recipes button) · states: the kit's */

import { MAX_SELECTIONS, type ProjectId, type ReasoningLevel, type SelectionChip } from '@taalcut/core';
import { Composer, nearestThinkingLevel, SelectionTray, type SelectionChipView } from '@taalcut/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useComposerEffects } from '../features/effects/use-effects';
import { useComposerRecipes, useRecipeContext } from '../features/recipes/use-recipes';
import {
  claimComposerRequest,
  removeSelection,
  selectionKey,
  useComposerRequest,
  useSelections,
} from './selection-store';
import { useChipViews } from './selection-views';
import { useAgentModel } from './use-agent-model';

export interface ChatComposerProps {
  busy: boolean;
  /** `reasoning` only when this chat picked a level; without it the model thinks at its own. */
  onSend: (text: string, reasoning?: ReasoningLevel) => void;
  onStop: () => void;
  defaultDraft?: string;
  /** The level this chat's last message went with (kept with its runs), if it picked one. */
  reasoning?: ReasoningLevel;
  /** The project this chat is about, for its recipes; without it, the one the editor has open. */
  projectId?: ProjectId;
  /** Why a message can't go yet (the chat is loading, or didn't load): the kit's Composer keeps the words. */
  hold?: string;
  /**
   * EDT1: what the editor beside this composer has selected, shown first among the chips (once, if it was also
   * added); removing it lets go of it in the editor. The docked chat sends it with the message.
   */
  selected?: { readonly chip: SelectionChip; readonly onRemove: () => void } | null;
}

/**
 * The chat's composer. The model is one setting for every chat (Settings →
 * Models' agent job); the thinking level belongs to the chat: it starts at
 * the model's own level, and once picked it goes with every message and is
 * kept with the chat's runs, so the chat reopens on it. The slider has
 * exactly the model's levels, under its provider's names (UX3-AGT); a level
 * the model doesn't have (picked on another model) shows, and is sent, as the
 * nearest it does, as pi-ai picks it.
 */
export function ChatComposer({
  busy,
  onSend,
  onStop,
  defaultDraft,
  reasoning: saved,
  projectId,
  hold,
  selected,
}: ChatComposerProps) {
  const root = useRef<HTMLDivElement>(null);
  const agent = useAgentModel();
  const recipes = useComposerRecipes(useRecipeContext(projectId));
  const effects = useComposerEffects(root);
  const [picked, setPicked] = useState<ReasoningLevel | undefined>(() => agent.pickedReasoning ?? saved);
  // The chat's history arrived: use it only when the person hasn't already picked a level in this session.
  useEffect(() => {
    if (saved && !agent.pickedReasoning) setPicked((prev) => prev ?? saved);
  }, [saved, agent.pickedReasoning]);

  // Words and chips another place asked for ("Ask about this slot"): a fresh draft, and the focus.
  const request = useComposerRequest();
  const [asked, setAsked] = useState<{ text: string; round: number } | null>(null);
  useEffect(() => {
    if (!claimComposerRequest(request)) return;
    if (request.text) setAsked((before) => ({ text: request.text, round: (before?.round ?? 0) + 1 }));
    else requestAnimationFrame(() => root.current?.querySelector('textarea')?.focus());
  }, [request]);
  // New words remount the box (a fresh draft): the new one takes the focus, the caret after the words.
  useEffect(() => {
    const box = asked ? root.current?.querySelector('textarea') : null;
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [asked]);
  const draft = asked?.text ?? defaultDraft;

  const added = useSelections();
  const liveKey = selected ? selectionKey(selected.chip) : null;
  const pending = useMemo(
    () =>
      selected && !added.some((entry) => entry.key === liveKey)
        ? [{ key: liveKey!, chip: selected.chip }, ...added]
        : added,
    [selected, liveKey, added],
  );
  const onRemove = (key: string) => (key === liveKey ? selected?.onRemove() : removeSelection(key));
  const resolved = useChipViews(useMemo(() => pending.map((entry) => entry.chip), [pending]));
  const chips = resolved
    .map((entry) => entry.view)
    .filter((view): view is SelectionChipView => view !== null);

  const { thinking, model, defaultReasoning, pickedReasoning, setReasoning, reason } = agent;
  const activePicked = pickedReasoning ?? picked;
  const shown = nearestThinkingLevel(activePicked ?? saved ?? defaultReasoning, thinking);

  return (
    <div ref={root} className="contents">
      <Composer
        key={asked?.round ?? 0}
        busy={busy}
        {...(hold ? { hold } : {})}
        onSend={(text) => onSend(text, activePicked ?? saved ? shown : undefined)}
        onStop={onStop}
        {...(draft ? { defaultDraft: draft } : {})}
        {...(agent.models ? { models: agent.models } : {})}
        thinking={{
          value: shown,
          levels: thinking,
          ...(model ? { model } : {}),
          ...(reason ? { reason } : {}),
          onChange: (level) => {
            setPicked(level);
            void setReasoning(level);
          },
        }}
        {...(chips.length
          ? { attachments: <SelectionTray chips={chips} onRemove={onRemove} max={MAX_SELECTIONS} /> }
          : {})}
        {...(recipes ? { recipes } : {})}
        effects={effects}
      />
    </div>
  );
}
