// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { VariantPlayerProvider, type VariantPlayerProps } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { VariantPlayer } from './variant-player';

const renderPlayer = (props: VariantPlayerProps) => <VariantPlayer {...props} />;

/**
 * The app's drivable variant player for every variants card under it (the chat, the dock, the kit), so the card's
 * Play the hooks plays every preview from one clock, as the editor's compare view does (P3-V3).
 */
export function AppVariantPlayers({ children }: { children: ReactNode }) {
  return <VariantPlayerProvider render={renderPlayer}>{children}</VariantPlayerProvider>;
}
