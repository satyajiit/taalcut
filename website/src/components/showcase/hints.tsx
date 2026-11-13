// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the showcases' names and how to use them · mode: Read · system: WEB2 Remix Vernacular
 * each feature page's showcase heading, and its one line on how to use what is in the window, by pointer, keyboard
 * and touch alike, with the keys as keycaps
 * states: n/a (words) */

import type { ReactNode } from 'react';
import { Key } from './plate';
import { HINT as ImportHint } from './import/meta';
import { HINT as ShortsHint } from './shorts/meta';
import { HINT as InstagramEditsHint } from './instagram-edits/meta';
import { HINT as LaunchVideosHint } from './launch-videos/meta';
import { HINT as ProductVideosHint } from './product-videos/meta';
import { HINT as PluginsHint } from './plugins/meta';

export const SHOWCASE_HINTS: Readonly<Record<string, { readonly title: string; readonly hint: ReactNode }>> =
  {
    'import': ImportHint,
    'shorts': ShortsHint,
    'instagram-edits': InstagramEditsHint,
    'launch-videos': LaunchVideosHint,
    'product-videos': ProductVideosHint,
    'plugins': PluginsHint,
    'reel-breakdown': {
      title: 'A saved reel, read',
      hint: (
        <>
          Point at a cut or tap it to see its time. Drag it, or move it a frame with Frame earlier and Frame
          later. By keyboard, Tab to a cut and press <Key>←</Key> or <Key>→</Key>; hold <Key>Shift</Key> to
          move it a beat.
        </>
      ),
    },
    'auto-pick': {
      title: 'A camera roll, searched',
      hint: 'Search it in plain words. Then swap the AI’s pick for one of the other shots, and back.',
    },
    templates: {
      title: 'A reel, its template, your version',
      hint: 'Choose a camera roll to fill it from. Its clips land in the slots on the music beats, and your version plays, cut like the reel.',
    },
    agent: {
      title: 'The agent checks its cut against the reel',
      hint: 'It runs when you scroll to it. Undo a swap and the check misses its moment again; Review and export turns the reel to your version.',
    },
    editor: {
      title: 'A cut in the editor',
      hint: (
        <>
          Choose a clip and press <Key>[</Key> to make it a beat shorter or <Key>]</Key> to make it a beat
          longer. Change the title’s values, then press Play.
        </>
      ),
    },
  };
