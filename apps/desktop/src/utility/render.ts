// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The render utility process (out/utility/render.mjs), started on demand. */
import { composeRender } from './roots/render-root';
import { exitOnTerminate, runUtility } from './runtime';

exitOnTerminate(
  runUtility('render', (config, main) => composeRender(config, process.pid, main), process.parentPort),
);
