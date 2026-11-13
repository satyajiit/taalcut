// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import * as Tone from 'tone';
import { renderInterfaceSound } from '../../../tools/audio-packs/tone-interface-recipes.mjs';

// This entry is bundled only by sounds:build and executed in an offline authoring browser.
globalThis.renderInterfaceSound = (sound, authoring) => renderInterfaceSound(Tone, sound, authoring);
