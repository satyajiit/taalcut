// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-OPS: every edit eval case, in a fixed order. */
import type { EditCase } from './case-types';
import { CUT_CASES } from './cases-cut';
import { LOOK_CASES } from './cases-look';
import { COMMENT_CASES } from './cases-comments';
import { MORE_CASES } from './cases-more';
import { SLIP_CASES } from './cases-slip';

export const EDIT_CASES: readonly EditCase[] = [
  ...CUT_CASES,
  ...LOOK_CASES,
  ...MORE_CASES,
  ...SLIP_CASES,
  ...COMMENT_CASES,
];
