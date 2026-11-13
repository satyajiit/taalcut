// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, RationalTime, type AuthoredProgram } from '@taalcut/core';

export const authoredSource = `<template><style>
#root { position: relative; width: 1920px; height: 1080px; background: #101218; }
#title { position: absolute; left: 120px; top: 200px; font-size: 96px; color: #ffffff; }
#cursor { position: absolute; width: 30px; height: 30px; background: #ffffff; }
</style><div id="root" data-composition-id="film" data-width="1920" data-height="1080" data-duration="30">
<h1 id="title" data-hf-id="hf-title">Launch</h1><div id="cursor" data-hf-id="hf-cursor"></div></div>
<script>const tl = gsap.timeline({ paused: true });
tl.fromTo('#title', { x: 0 }, { x: 600, duration: 20, ease: 'none' }, 0);
tl.fromTo('#cursor', { x: 0, y: 0 }, { x: 400, y: 300, duration: 5, ease: 'none' }, 10);
tl.set('#cursor', { opacity: 0 }, 7);
tl.set('#cursor', { opacity: 1 }, 9);
window.__timelines['film'] = tl;</script></template>`;

export const authoredFixture = (): AuthoredProgram => ({
  id: newId<'AuthoredProgram'>(),
  hash: 'a'.repeat(64),
  version: 1,
  entry: 'index.html',
  files: [{ path: 'index.html', sha256: 'b'.repeat(64), bytes: authoredSource.length }],
  canvas: { width: 1920, height: 1080, rate: { num: 60, den: 1 } },
  duration: RationalTime.of(1800, { num: 60, den: 1 }),
  assetIds: [],
  chapters: [
    {
      id: 'opening',
      name: 'Opening',
      start: RationalTime.of(0, { num: 60, den: 1 }),
      duration: RationalTime.of(1800, { num: 60, den: 1 }),
    },
  ],
});
