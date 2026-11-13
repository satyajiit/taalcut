// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Brand kits and looks as the pages read them (appContract.styles), kept current: every change on the bus (a
 * field committed here, the agent's edit, ⌘Z, a look applied somewhere) reloads them. Styles have no
 * library.changed entity, so command.changed is the signal.
 */
import { styleAssetUrl, type StyleId, type StyleLogo, type StyleSummary } from '@taalcut/core';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import type { MediaUrls } from '../../backend/media';
import { useMediaUrls } from '../../services/provider';

/** Bumped by every change on the bus. */
function useCommandRound(): number {
  const [round, setRound] = useState(0);
  useBackendEvents(['command.changed'], () => setRound((n) => n + 1));
  return round;
}

export function useStyles() {
  const backend = useBackend();
  const round = useCommandRound();
  return useRpcQuery((signal) => backend.styles.list(undefined, { signal }), [backend, round]);
}

export function useStyle(styleId: StyleId) {
  const backend = useBackend();
  const round = useCommandRound();
  return useRpcQuery((signal) => backend.styles.get({ styleId }, { signal }), [backend, styleId, round]);
}

/** What names a kit now (styles.usedBy), for Delete's line. */
export function useStyleUsage(styleId: StyleId) {
  const backend = useBackend();
  const round = useCommandRound();
  return useRpcQuery((signal) => backend.styles.usedBy({ styleId }, { signal }), [backend, styleId, round]);
}

type LogoRef = Pick<StyleLogo, 'asset' | 'mediaType'>;

/**
 * A logo's URL the page can load: main serves app://media/styles/<sha256>.<ext>, which `media.preview` passes
 * through in Electron; a plain browser has no media host, so the swatch shows instead.
 */
export function logoUrl(media: MediaUrls, logo: LogoRef | null): string | null {
  return logo ? media.preview(styleAssetUrl(logo)) : null;
}

export function useLogoUrl(): (style: Pick<StyleSummary, 'logo'>) => string | null {
  const media = useMediaUrls();
  return (style) => logoUrl(media, style.logo);
}
