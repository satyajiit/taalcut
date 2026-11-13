// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The LAN utility process (out/utility/lan.mjs), started on demand. */
import { composeLan } from './roots/lan-root';
import { exitOnTerminate, runUtility } from './runtime';

exitOnTerminate(runUtility('lan', (config, main) => composeLan(config, main), process.parentPort));
