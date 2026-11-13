// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The chat templates the llama-server sidecar renders requests with (LRN1-CTX, SPEC "Chat templates"): each model's
 * own template from its GGUF, with one change, the tools block. The GGUF's template writes each tool as
 * `tool | tojson`, which llama.cpp's jinja engine lays out as spaced JSON (", " and ": "); the same tools written
 * compact cost about 18% fewer tokens (the Analyst's 12: 3,013 against 2,474), on every turn of every step that is
 * offered tools. Nothing else in the template changes: the tool-call format, thinking and vision stay the model's.
 */

/** How the GGUF templates write one tool, and how the sidecar's write it. */
export const SPACED_TOOL = '{{- tool | tojson }}';
export const COMPACT_TOOL = '{{- tool | tojson(separators=(",", ":")) }}';

/** `own` with its tools written compact (the test holds each shipped template to one such tool line). */
export function compactToolsTemplate(own: string): string {
  return own.replace(SPACED_TOOL, COMPACT_TOOL);
}
