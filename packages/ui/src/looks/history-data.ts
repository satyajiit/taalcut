// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The styleBatch card's "Undo all" (P3-V16) shows only while the batch is the change ⌘Z would undo (no
 * out-of-order undo): CardDataPhase3.watchNewestChange says which change that is.
 */
import type { CommandId } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useCardData } from '../cards/card-data';

/** Whether `commandId` is the newest change in the app-wide history; false while unknown or without data. */
export function useIsNewestChange(commandId: CommandId): boolean {
  const data = useCardData();
  const [newest, setNewest] = useState<CommandId | null>(null);
  useEffect(() => data.watchNewestChange?.(setNewest), [data]);
  return newest === commandId;
}
