// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Markdown bundled as text (tsdown `loader: { '.md': 'text' }`): SOUL.md in the agent process. */
declare module '*.md' {
  const text: string;
  export default text;
}
