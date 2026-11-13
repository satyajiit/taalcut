// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: debug bundle preview · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · what the bundle would hold, one hairline row per file: its path (mono, as written), size,
 *   and what was replaced; the total under them. Nothing is written until Send or Save.
 * states: loading (spinner line) · error (the cause) · ready (rows and total) */

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { DEBUG_SECTIONS, DebugCollectOptions } from '@taalcut/core';
import { ErrorLine } from '@taalcut/ui';
import { LoaderCircle } from 'lucide-react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import { formatBytes } from '../shared/format';

const SECTION_NAMES: Readonly<Record<(typeof DEBUG_SECTIONS)[number], MessageDescriptor>> = {
  environment: msg`This Mac and the app’s version`,
  logs: msg`Logs`,
  traces: msg`Traces`,
  runs: msg`The agent’s recent runs`,
  cloudCalls: msg`Requests to models`,
  jobs: msg`Background jobs`,
  components: msg`Installed models and tools`,
  settings: msg`Settings`,
  recovery: msg`Crash recovery`,
};

/** What a bundle with these options would hold (`feedback.preview`). */
export function BundlePreview({ options }: { options: DebugCollectOptions }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const preview = useRpcQuery(
    (signal) => backend.feedback.preview(options, { signal }),
    [backend, options.includeChatText],
  );
  if (preview.status === 'error') return <ErrorLine error={preview.error} />;
  if (!preview.data)
    return (
      <p aria-busy="true" className="m-0 flex items-center gap-2 text-sm text-ink-2">
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        <Trans>Looking at what it would hold…</Trans>
      </p>
    );
  const total = formatBytes(i18n, preview.data.totalBytes);
  return (
    <div data-slot="bundle-preview" className="flex flex-col gap-1">
      <ul aria-label={t`In the bundle`} className="m-0 flex list-none flex-col p-0">
        {preview.data.sections.map((section) => {
          const replaced = section.redactions.paths + section.redactions.secrets + section.redactions.text;
          const size = formatBytes(i18n, section.bytes);
          return (
            <li
              key={section.path}
              className="flex items-baseline justify-between gap-3 border-t border-rule-subtle py-1.5 text-sm first:border-t-0"
            >
              <span className="min-w-0 truncate text-ink">{i18n._(SECTION_NAMES[section.section])}</span>
              <span className="shrink-0 text-xs text-ink-2 tabular-nums">
                {size}
                {replaced > 0 ? (
                  <>
                    {' · '}
                    <Plural value={replaced} one="# thing replaced" other="# things replaced" />
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-xs text-ink-2 tabular-nums">
        <Trans>
          {total} in all. Paths, keys and passwords are replaced; what you typed stays out unless you include
          it.
        </Trans>
      </p>
    </div>
  );
}
