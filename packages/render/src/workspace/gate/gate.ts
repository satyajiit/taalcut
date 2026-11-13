// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gate (HFW1 "hf: gate"): a composition the model wrote passes HyperFrames' own lint as a sub-composition with
 * Studio's strictness (any error fails; the bundled fonts' faces are given as the page's own styles, since the
 * composition may not declare @font-face), then Taalcut's allowlists and limits and the lowering (prepare.ts).
 * Every finding carries a fix hint the model can act on.
 */
import { lintHyperframeHtml } from '@hyperframes/core/lint';
import { WORKSPACE_LIMITS } from '@taalcut/core';
import { fontFacesFor } from '../../captions/fonts';
import { fontFaces } from '../../compile/css';
import type { CaptionFontId } from '../../types';
import { CURATED_FAMILIES } from './css-rules';
import { refusal, type Gated, type WorkspaceFinding } from './finding';
import { prepareComposition, type PreparedComposition } from './prepare';

/** The file size the gate reads at most (64 KB, the workspace's own limit). */
export const MAX_FILE_BYTES = WORKSPACE_LIMITS.fileBytes;

/** Every bundled face, as the lint reads them: Taalcut gives the page these, never the composition. */
function bundledFaces(): string {
  const fonts = [...new Set(CURATED_FAMILIES.values())] as CaptionFontId[];
  return fontFaces(fontFacesFor(fonts)).join('\n');
}

export async function lintComposition(html: string, file: string): Promise<WorkspaceFinding[]> {
  const lint = await lintHyperframeHtml(html, {
    filePath: file,
    isSubComposition: true,
    host: 'studio',
    externalStyles: [{ href: '_taalcut/fonts.css', content: bundledFaces() }],
  });
  return lint.findings.map((finding) => ({
    code: `hf.${finding.code}`,
    severity: finding.severity === 'error' ? 'error' : 'warning',
    message: finding.message,
    fixHint: finding.fixHint ?? 'See HyperFrames’ lint rule of this name.',
    file,
  }));
}

/**
 * Gates one composition's text: HyperFrames' lint, then Taalcut's rules and the lowering. A workspace's files go
 * through `gateComposition` (workspace-gate.ts), which adds the file limits and the assets and keeps the report.
 */
export async function gateHtml(html: string, file = 'index.html'): Promise<Gated<PreparedComposition>> {
  if (Buffer.byteLength(html, 'utf8') > MAX_FILE_BYTES)
    return {
      ok: false,
      findings: [
        refusal(
          'gate.size',
          `${file} is over 64 KB`,
          'Keep the composition small: move repeated parts into classes.',
        ),
      ],
    };
  const lint = await lintComposition(html, file);
  const errors = lint.filter((finding) => finding.severity === 'error');
  const warnings = lint.filter((finding) => finding.severity !== 'error');
  const prepared = prepareComposition(html);
  if (!prepared.ok) return { ok: false, findings: [...errors, ...prepared.findings, ...warnings] };
  if (errors.length > 0) return { ok: false, findings: [...errors, ...warnings] };
  return { ok: true, value: prepared.value, warnings };
}
