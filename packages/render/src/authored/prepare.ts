// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { buildDocument, flatElements } from '@hyperframes/sdk';
import { AUTHORED_PROGRAM_LIMITS } from '@taalcut/core';
import { prepareComposition } from '../workspace/gate/prepare';
import { refusal, type Gated } from '../workspace/gate/finding';
import type { PreparedComposition } from '../workspace/gate/prepare';
import { WORKSPACE_MARKUP } from '../workspace/gate/markup-rules';

export const AUTHORED_COMPILE_LIMITS = { seconds: 600, nodes: 4000, depth: 40, tweens: 5000 } as const;

/** The SDK's inline styles become checked CSS rules; source remains its lossless serialized document. */
export function prepareAuthoredProgram(source: string): Gated<PreparedComposition> {
  if (new TextEncoder().encode(source).length > AUTHORED_PROGRAM_LIMITS.sourceBytes)
    return {
      ok: false,
      findings: [refusal('authored.size', 'The source exceeds 1 MiB', 'Reduce its markup.')],
    };
  try {
    const document = buildDocument(source);
    const total = document.compositionDuration;
    for (const element of flatElements(document.roots)) {
      if (element.attributes['data-start'] === undefined) continue;
      const start = Number(element.attributes['data-start']);
      const duration =
        element.attributes['data-duration'] === undefined
          ? undefined
          : Number(element.attributes['data-duration']);
      if (
        !Number.isFinite(start) ||
        start < 0 ||
        (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) ||
        (total !== null && (start >= total || (duration !== undefined && start + duration > total + 1e-6)))
      )
        return {
          ok: false,
          findings: [
            refusal(
              'authored.timing',
              'A layer lies outside the film',
              'Keep each timed layer inside the program duration.',
            ),
          ],
        };
    }
    const rules = flatElements(document.roots).flatMap((element) => {
      const styles = Object.entries(element.inlineStyles);
      if (styles.length === 0) return [];
      const declarations = styles.map(([key, value]) => {
        const name = key.startsWith('--')
          ? key
          : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        return `${name}:${value}`;
      });
      return [`[data-hf-id="${element.id}"]{${declarations.join(';')}}`];
    });
    // Exclude scripts and styles from attribute normalization: their string literals are not DOM attributes.
    const blocks: string[] = [];
    let normalized = document.html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (block) => {
      blocks.push(block);
      return `<!--authored-block-${blocks.length - 1}-->`;
    });
    normalized = normalized.replace(/\sstyle="[^"]*"/gi, '');
    normalized = normalized.replace(
      /<!--authored-block-(\d+)-->/g,
      (_, index: string) => blocks[Number(index)] ?? '',
    );
    if (rules.length > 0) {
      if (/<\/style\s*>/i.test(normalized))
        normalized = normalized.replace(/<\/style\s*>/i, `${rules.join('\n')}</style>`);
      else
        normalized = normalized.replace(
          /<template\b[^>]*>/i,
          (tag) => `${tag}<style>${rules.join('\n')}</style>`,
        );
    }
    return prepareComposition(normalized, {
      maxSeconds: AUTHORED_COMPILE_LIMITS.seconds,
      markupLimits: { nodes: AUTHORED_COMPILE_LIMITS.nodes, depth: AUTHORED_COMPILE_LIMITS.depth },
      tweens: AUTHORED_COMPILE_LIMITS.tweens,
      maxCssRules: 4000,
      cubicPaths: true,
      markup: {
        ...WORKSPACE_MARKUP,
        maxText: 12_000,
        attributeProblem: (tag, name, value) =>
          name === 'data-hf-id'
            ? /^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(value)
              ? null
              : 'invalid stable element identity'
            : WORKSPACE_MARKUP.attributeProblem(tag, name, value),
      },
    });
  } catch {
    return {
      ok: false,
      findings: [
        refusal(
          'authored.parse',
          'The source could not be parsed',
          'Write one complete Hyperframes template.',
        ),
      ],
    };
  }
}
