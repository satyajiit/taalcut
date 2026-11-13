// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Selection chips (P2-M7, V3): what the user points the chat at. The editor
 * says what is selected now (`setCurrentSelection`); "Add to chat" (⌘⇧A, ⌘K,
 * the inspector, `chat.addSelection`) puts it in the composer's draft, where
 * the chips stay until the message is sent or they are removed. A card's
 * "Ask about this slot" (`CardActions.ask`) puts words and chips in the draft
 * and asks the composer on screen to take focus. Outside React's tree, so the
 * editor, ⌘K, cards and whichever composer is on screen share one draft.
 */
import { MAX_SELECTIONS, type SelectionChip } from '@taalcut/core';
import { useSyncExternalStore } from 'react';

export interface PendingChip {
  readonly key: string;
  readonly chip: SelectionChip;
}

/** Words for the composer and a request to focus it ("Ask about this slot"). */
export interface ComposerRequest {
  readonly text: string;
  readonly tick: number;
}

/** Two chips that point at the same thing share a key, so adding one twice keeps one. */
export function selectionKey(chip: SelectionChip): string {
  switch (chip.kind) {
    case 'clip':
      return `clip:${chip.timelineId}:${chip.clipId}`;
    // A clip named by an item chip is the same thing as the old clip chip's.
    case 'item':
      return `${chip.itemKind === 'clip' ? 'clip' : 'item'}:${chip.timelineId}:${chip.itemId}`;
    case 'range': {
      const { start, duration } = chip.range;
      return `range:${chip.timelineId}:${start.value}/${start.rate.num}:${duration.value}`;
    }
    case 'slot':
      return `slot:${chip.templateId}:${chip.slotId}`;
    case 'effect':
      return `effect:${chip.effectId}`;
    case 'asset':
      return `asset:${chip.assetId}`;
  }
}

export type AddOutcome = 'added' | 'already' | 'full';
export type ToggleOutcome = 'added' | 'removed' | 'full';

export interface SelectionStore {
  setCurrentSelection(chip: SelectionChip | null): void;
  currentSelection(): SelectionChip | null;
  addSelection(chip: SelectionChip): AddOutcome;
  toggleSelection(chip: SelectionChip): ToggleOutcome;
  clearEffectSelections(): void;
  clearSelections(): void;
  addCurrentSelection(): AddOutcome | null;
  removeSelection(key: string): void;
  takeSelections(): SelectionChip[];
  selections(): readonly PendingChip[];
  askWith(text: string, selections: readonly SelectionChip[]): void;
  composerRequest(): ComposerRequest | null;
  claimComposerRequest(next: ComposerRequest | null): next is ComposerRequest;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export function createSelectionStore(): SelectionStore {
  let chips: readonly PendingChip[] = [];
  let current: SelectionChip | null = null;
  let request: ComposerRequest | null = null;
  let claimed = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };

  return {
    setCurrentSelection(chip) {
      if (current === chip) return;
      if (current && chip && selectionKey(current) === selectionKey(chip)) return;
      current = chip;
      changed();
    },
    currentSelection: () => current,
    addSelection(chip) {
      const key = selectionKey(chip);
      if (chips.some((entry) => entry.key === key)) return 'already';
      if (chips.length >= MAX_SELECTIONS) return 'full';
      chips = [...chips, { key, chip }];
      changed();
      return 'added';
    },
    toggleSelection(chip) {
      const key = selectionKey(chip);
      if (chips.some((entry) => entry.key === key)) {
        this.removeSelection(key);
        return 'removed';
      }
      return this.addSelection(chip) === 'full' ? 'full' : 'added';
    },
    clearEffectSelections() {
      const next = chips.filter((entry) => entry.chip.kind !== 'effect');
      if (next.length === chips.length) return;
      chips = next;
      changed();
    },
    clearSelections() {
      if (chips.length === 0) return;
      chips = [];
      changed();
    },
    addCurrentSelection() {
      return current ? this.addSelection(current) : null;
    },
    removeSelection(key) {
      const next = chips.filter((entry) => entry.key !== key);
      if (next.length === chips.length) return;
      chips = next;
      changed();
    },
    takeSelections() {
      const taken = chips.map((entry) => entry.chip);
      if (taken.length) {
        chips = [];
        changed();
      }
      return taken;
    },
    selections: () => chips,
    askWith(text, selections) {
      for (const chip of selections) this.addSelection(chip);
      request = { text, tick: (request?.tick ?? 0) + 1 };
      changed();
    },
    composerRequest: () => request,
    claimComposerRequest(next): next is ComposerRequest {
      if (!next || next.tick <= claimed) return false;
      claimed = next.tick;
      return true;
    },
    reset() {
      chips = [];
      current = null;
      request = null;
      claimed = 0;
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const selectionStore: SelectionStore = createSelectionStore();

/** What the editor has selected now (null: nothing), for ⌘⇧A. */
export function setCurrentSelection(chip: SelectionChip | null): void {
  selectionStore.setCurrentSelection(chip);
}

export function currentSelection(): SelectionChip | null {
  return selectionStore.currentSelection();
}

export function useCurrentSelection(store: SelectionStore = selectionStore): SelectionChip | null {
  return useSyncExternalStore(store.subscribe, store.currentSelection);
}

/** Adds a chip to the draft (at most MAX_SELECTIONS; the same thing once). */
export function addSelection(chip: SelectionChip): AddOutcome {
  return selectionStore.addSelection(chip);
}

/** Toggles a chip in the draft (used by multi-select effect tags). */
export function toggleSelection(chip: SelectionChip): ToggleOutcome {
  return selectionStore.toggleSelection(chip);
}

/** Removes all tagged effect chips from the draft. */
export function clearEffectSelections(): void {
  selectionStore.clearEffectSelections();
}

/** Clears all draft selection chips before starting a fresh chat handoff. */
export function clearSelections(): void {
  selectionStore.clearSelections();
}

/** "Add to chat": the editor's current selection, if there is one. */
export function addCurrentSelection(): AddOutcome | null {
  return selectionStore.addCurrentSelection();
}

export function removeSelection(key: string): void {
  selectionStore.removeSelection(key);
}

/** The draft's chips, for sending; they leave the draft with the message. */
export function takeSelections(): SelectionChip[] {
  return selectionStore.takeSelections();
}

export function useSelections(store: SelectionStore = selectionStore): readonly PendingChip[] {
  return useSyncExternalStore(store.subscribe, store.selections);
}

/** Puts words and chips into the draft and asks the composer on screen to take focus. */
export function askWith(text: string, selections: readonly SelectionChip[]): void {
  selectionStore.askWith(text, selections);
}

/** The latest request to fill and focus the composer; a composer handles each tick once. */
export function composerRequest(): ComposerRequest | null {
  return selectionStore.composerRequest();
}

export function useComposerRequest(store: SelectionStore = selectionStore): ComposerRequest | null {
  return useSyncExternalStore(store.subscribe, store.composerRequest);
}

/**
 * True once per request: the composer that sees it first takes the words and the focus (the chat page's and
 * the editor's docked one can both be mounted).
 */
export function claimComposerRequest(next: ComposerRequest | null): next is ComposerRequest {
  return selectionStore.claimComposerRequest(next);
}

/** Forget everything (tests). */
export function resetSelectionsForTests(): void {
  selectionStore.reset();
}
