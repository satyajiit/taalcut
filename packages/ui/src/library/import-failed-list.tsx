// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: import failed list (See which, inside the import strip) · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.3 (hairline rows on the strip's well, no card in a card)
 * states: loading (bones in the rows' shape: a kind mark, the name, the reason) · loaded (each file: its kind
 *   icon, its name as the user wrote it, why in words) · more (how many beyond the rows shown) · error (the cause
 *   and Try again, an ErrorLine) · empty (nothing left to list: one quiet line) · rows are text, not controls
 * motion: the list arrives once (8 px rise, 220 ms, ease-out); reduced motion: a 150 ms fade
 * contrast: ink and ink-2 ≥ 7:1, ink-3 icons ≥ 4.5:1 on sunken; rule-subtle hairlines are decoration
 */
import { Plural, useLingui } from '@lingui/react/macro';
import type { AssetKind, TaalcutError } from '@taalcut/core';
import { AudioLines, Film, Image } from 'lucide-react';
import type { ReactNode } from 'react';
import { Arrival } from '../chat/arrival';
import { Button } from '#components/button';
import { VERB_ICONS } from '../icons/concepts';
import { cn } from '#lib/cn';
import { ErrorLine } from '../cards/error-line';
import { HANG } from './import-failed-files';

export interface FailedFile {
  readonly id: string;
  readonly kind: AssetKind;
  /** The file's name as the user wrote it; wrap it in UserContent. */
  readonly name: ReactNode;
  /** Why it failed, in words (import-outcome.ts failureReason). */
  readonly reason: string;
}

export interface ImportFailedListProps {
  readonly id?: string;
  readonly files: readonly FailedFile[];
  /** Failed files beyond those listed. */
  readonly more?: number;
  readonly loading?: boolean;
  readonly error?: TaalcutError | null;
  readonly onRetry?: () => unknown;
}

const KIND_ICON = { video: Film, image: Image, live_photo: Image, audio: AudioLines } as const;

export function ImportFailedList({ id, files, more = 0, loading, error, onRetry }: ImportFailedListProps) {
  const { t } = useLingui();
  return (
    <Arrival animate className={cn('flex flex-col gap-2', HANG)}>
      <section
        id={id}
        aria-label={t`Files that need a look`}
        data-slot="import-failed-list"
        aria-busy={loading}
      >
        {error ? (
          <div className="flex flex-wrap items-center gap-3">
            <ErrorLine error={error} className="min-w-0 flex-1" />
            {onRetry ? (
              <Button size="sm" variant="secondary" icon={VERB_ICONS.retry} onClick={() => void onRetry()}>
                {t`Try again`}
              </Button>
            ) : null}
          </div>
        ) : loading ? (
          <FailedBones />
        ) : files.length === 0 ? (
          <p className="m-0 text-xs text-ink-2">{t`Nothing left to look at here.`}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-rule-subtle border-y border-rule-subtle p-0">
            {files.map((file) => {
              const Icon = KIND_ICON[file.kind];
              return (
                <li key={file.id} data-slot="import-failed-file" className="flex items-start gap-2 py-1.5">
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="m-0 truncate text-sm font-medium text-ink">{file.name}</p>
                    <p className="m-0 text-xs text-ink-2">{file.reason}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {more > 0 && !loading && !error ? (
          <p className="m-0 pt-2 text-xs text-ink-3">
            <Plural value={more} one="And # more file" other="And # more files" />
          </p>
        ) : null}
      </section>
    </Arrival>
  );
}

/** Two rows in the list's shape while the files' reasons load. */
function FailedBones() {
  const { t } = useLingui();
  return (
    <div className="flex flex-col divide-y divide-rule-subtle border-y border-rule-subtle">
      <span className="sr-only" role="status">
        {t`Loading`}
      </span>
      {[62, 48].map((width) => (
        <div key={width} aria-hidden className="flex items-start gap-2 py-1.5">
          <span className="tc-bone mt-0.5 size-4 shrink-0 rounded-sm bg-hover" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
            <span className="tc-bone block h-3.5 rounded-sm bg-hover" style={{ width: `${width}%` }} />
            <span className="tc-bone block h-3 rounded-sm bg-hover" style={{ width: `${width + 24}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
