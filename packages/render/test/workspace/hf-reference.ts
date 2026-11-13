// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HyperFrames' own render of a workspace composition, for the fold's equality tests (HFW1): a HyperFrames project
 * whose host composition mounts the fixture file unchanged as a sub-composition (`data-composition-src`), so
 * HyperFrames' runtime loads it, scopes it and runs its own script with real GSAP. The host gives the page what
 * Taalcut's page gives a folded composition: the canvas over a flat colour, the bundled fonts' faces, Taalcut's text
 * font as the default, and the pinned GSAP files from the bundle path (never a CDN).
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fontFacesFor } from '../../src/captions/fonts';
import { familyList, fontFaces, TEXT_FONT } from '../../src/compile/css';
import { gsapBundlePath, gsapDistDir, type GsapFile } from '../../src/motion/gsap-files';
import { fontStack } from '../../src/captions/fonts';
import type { CaptionFontId } from '../../src/types';
import { FONTS_DIR } from '../support/fonts';

export interface ReferenceProject {
  readonly dir: string;
  readonly compositionId: string;
  readonly fixture: string;
  readonly seconds: number;
  readonly fonts: readonly CaptionFontId[];
  readonly gsap: readonly GsapFile[];
  /** The flat colour under the composition, as #rrggbb. */
  readonly background: string;
}

export async function writeReferenceProject(project: ReferenceProject): Promise<void> {
  const { dir } = project;
  await mkdir(join(dir, 'compositions'), { recursive: true });
  await mkdir(join(dir, 'vendor', 'gsap'), { recursive: true });
  await mkdir(join(dir, 'fonts'), { recursive: true });
  for (const file of project.gsap) await copyFile(join(gsapDistDir(), file), join(dir, gsapBundlePath(file)));
  const faces = fontFacesFor([TEXT_FONT, ...project.fonts]);
  for (const face of faces) await copyFile(join(FONTS_DIR, face.file), join(dir, 'fonts', face.file));
  await copyFile(project.fixture, join(dir, 'compositions', `${project.compositionId}.html`));
  const seconds = String(project.seconds);
  await writeFile(
    join(dir, 'index.html'),
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<style>',
      ...fontFaces(faces),
      `html, body { margin: 0; padding: 0; background: ${project.background}; overflow: hidden; }`,
      `#root { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: ${project.background}; font-family: ${familyList(fontStack(TEXT_FONT))}; }`,
      '</style>',
      '</head>',
      '<body>',
      `<div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-fps="30" data-duration="${seconds}">`,
      `<div id="${project.compositionId}-host" data-composition-id="${project.compositionId}" data-composition-src="compositions/${project.compositionId}.html" data-start="0" data-duration="${seconds}" data-width="1080" data-height="1920"></div>`,
      '</div>',
      ...project.gsap.map((file) => `<script src="${gsapBundlePath(file)}"></script>`),
      '<script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>',
      '</body>',
      '</html>',
      '',
    ].join('\n'),
  );
}
