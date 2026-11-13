// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Copies the renderer build into out/renderer, where the app:// handler
 * serves it from (inside app.asar once packaged).
 *
 *   apps/renderer/dist/index.html exists  → copy apps/renderer/dist
 *   otherwise, or with --placeholder       → copy static/renderer-placeholder and out/placeholder/probe.mjs
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const rendererDist = join(desktopDir, '..', 'renderer', 'dist');
const placeholder = join(desktopDir, 'static', 'renderer-placeholder');
const target = join(desktopDir, 'out', 'renderer');

const usePlaceholder =
  process.argv.includes('--placeholder') || !existsSync(join(rendererDist, 'index.html'));
const source = usePlaceholder ? placeholder : rendererDist;

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
// The placeholder's script is built by tsdown (src/placeholder/probe.ts); only the placeholder ships it.
const probeDir = join(desktopDir, 'out', 'placeholder');
if (usePlaceholder) cpSync(join(probeDir, 'probe.mjs'), join(target, 'probe.mjs'));
rmSync(probeDir, { recursive: true, force: true });
process.stdout.write(`renderer: ${relative(desktopDir, source)} → ${relative(desktopDir, target)}\n`);
