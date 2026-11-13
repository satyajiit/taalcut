// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { toggleShowKaatu, useShowKaatu } from './kaatu-preference';

/**
 * ⌘K's Show Kaatu or Hide Kaatu (UX4), for the palette's owner to list in its View group with the icon it gives
 * the other view toggles: what a press does, by the preference's state.
 */
export function useKaatuCommand(): { id: string; title: string; keywords: string[]; run: () => void } {
  const { t } = useLingui();
  const [on] = useShowKaatu();
  return {
    id: 'view.kaatu',
    title: on ? t`Hide Kaatu` : t`Show Kaatu`,
    keywords: [t`mascot`, t`beaver`, t`companion`],
    run: toggleShowKaatu,
  };
}
