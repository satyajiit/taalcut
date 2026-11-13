// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { run } from './test-budget/run.ts';

process.exit(await run(process.argv.slice(2)));
