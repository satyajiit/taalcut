// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createContext, useContext, type ReactNode } from 'react';
import type { ButtonProps } from '#components/button';

/**
 * Which card in a transcript holds the screen's one marigold primary (DESIGN.md: one per screen; UX round 1). The
 * transcript names the newest card that asks for an answer; every other card shows its main action as secondary.
 * `null`: nothing asks, so each card keeps its own.
 */
const PrimaryHolderContext = createContext<{ readonly holder: string | null } | null>(null);

export function PrimaryHolderProvider({ holder, children }: { holder: string | null; children: ReactNode }) {
  return <PrimaryHolderContext.Provider value={{ holder }}>{children}</PrimaryHolderContext.Provider>;
}

/** Whether this card may fill its main action with marigold: always outside a transcript, else only the holder. */
export function useHoldsPrimary(cardId: string): boolean {
  const context = useContext(PrimaryHolderContext);
  return context === null || context.holder === null || context.holder === cardId;
}

/**
 * Whether the card sits in a transcript, where the run's waiting line already says "waiting": a pending card there
 * needs no "Waiting for you" chip of its own.
 */
export function useInTranscript(): boolean {
  return useContext(PrimaryHolderContext) !== null;
}

/** The variant of a card's main action: primary when it holds the screen's one, else secondary. */
export function usePrimaryVariant(cardId: string): NonNullable<ButtonProps['variant']> {
  return useHoldsPrimary(cardId) ? 'primary' : 'secondary';
}
