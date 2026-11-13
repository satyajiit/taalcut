// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: uploads from the phone · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * hairline rows: the phone's file name, its size, a neutral bar while it travels, then what happened in words; a row
 *   that arrives after the page opened rises in (Arrival: 8 px and a fade, 220 ms; reduced motion: the fade)
 * states per row: uploading (neutral bar by transform, speed and time left) · paused (waiting for the phone) ·
 *   checking · importing (spinner) · imported (success icon and word, Open) · already in the library (neutral, Open
 *   the one you have) · smaller copy (warning icon and what to do) · rejected or failed (the cause) · cancelled;
 *   Cancel (spins while the server drops it; a refusal says why under the row, Try again) and Open are ghost
 *   Buttons (eight states)
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import type { Result, TaalcutError, TransferFile } from '@taalcut/core';
import { Arrival, Button, cn, ErrorLine, errorMessage, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, CircleSlash, CirclePause, LoaderCircle, Smartphone } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatBytes, formatDuration } from '../../../shared/format';

const STATE_WORDS: Readonly<Record<TransferFile['state'], MessageDescriptor>> = {
  uploading: msg`Sending`,
  paused: msg`Paused on the phone`,
  checking: msg`Checking`,
  importing: msg`Adding to your library`,
  imported: msg`In your library`,
  duplicate: msg`Already in your library`,
  rejected: msg`Not a photo or video`,
  failed: msg`Didn’t arrive`,
  cancelled: msg`Cancelled`,
};

function StateIcon({ state }: { state: TransferFile['state'] }) {
  switch (state) {
    case 'uploading':
    case 'checking':
    case 'importing':
      return <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-ink-2" />;
    case 'imported':
      return <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />;
    case 'duplicate':
      return <CircleCheck aria-hidden className="size-4 shrink-0 text-ink-3" />;
    case 'paused':
      return <CirclePause aria-hidden className="size-4 shrink-0 text-warning-strong" />;
    case 'failed':
    case 'rejected':
      return <CircleAlert aria-hidden className="size-4 shrink-0 text-danger-strong" />;
    default:
      return <CircleSlash aria-hidden className="size-4 shrink-0 text-ink-3" />;
  }
}

type Cancel = () => Promise<Result<TransferFile> | undefined>;

function FileRow({ file, onCancel }: { file: TransferFile; onCancel: Cancel }) {
  const { t, i18n } = useLingui();
  const nameId = useId();
  const [cancelling, setCancelling] = useState(false);
  const [refused, setRefused] = useState<TaalcutError | null>(null);
  const row = useRef<HTMLDivElement>(null);
  // Cancel goes when the file stops sending, and took focus with it: back to the row (its Open once it has one),
  // so Tab carries on from here, not from the top of the page.
  const cancelHadFocus = useRef(false);
  useEffect(() => {
    if (file.state === 'uploading' || !cancelHadFocus.current) return;
    cancelHadFocus.current = false;
    if (document.activeElement === null || document.activeElement === document.body)
      (row.current?.querySelector<HTMLElement>('a[href]') ?? row.current)?.focus();
  }, [file.state]);
  const cancel = async () => {
    setCancelling(true);
    setRefused(null);
    const result = await onCancel();
    setCancelling(false);
    if (result && !result.ok) setRefused(result.error);
  };
  const fraction = file.sizeBytes > 0 ? file.receivedBytes / file.sizeBytes : 0;
  const done = file.state === 'imported' || file.state === 'duplicate';
  const bad = file.state === 'failed' || file.state === 'rejected';
  const smaller = file.reencode?.verdict === 'likely';
  const speed = file.bytesPerSecond ? formatBytes(i18n, file.bytesPerSecond) : null;
  const left = file.etaMs !== undefined ? formatDuration(i18n, file.etaMs) : null;
  return (
    <div
      ref={row}
      tabIndex={-1}
      data-slot="transfer-file"
      data-state={file.state}
      className="flex flex-col gap-1.5 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StateIcon state={file.state} />
        <UserContent id={nameId} translate="no" className="min-w-0 type-label text-ink">
          {file.name}
        </UserContent>
        <span className="type-meta text-ink-3 tabular-nums">{formatBytes(i18n, file.sizeBytes)}</span>
        <span
          className={cn(
            'ms-auto type-body',
            file.state === 'imported'
              ? 'text-success-strong'
              : bad
                ? 'text-danger-strong'
                : file.state === 'paused'
                  ? 'text-warning-strong'
                  : 'text-ink-2',
          )}
        >
          {i18n._(STATE_WORDS[file.state])}
        </span>
        {file.assetId && done ? (
          <Button asChild size="sm" variant="ghost" icon={VERB_ICONS.open}>
            <Link to="/library/$assetId" params={{ assetId: file.assetId }}>
              {t`Open`}
            </Link>
          </Button>
        ) : null}
        {file.state === 'uploading' ? (
          <Button
            size="sm"
            variant="ghost"
            loading={cancelling}
            onClick={() => void cancel()}
            onFocus={() => (cancelHadFocus.current = true)}
            // Removed while focused, it may still blur on the way out: only a blur it survives clears the mark.
            onBlur={(event) => {
              if (event.currentTarget.isConnected) cancelHadFocus.current = false;
            }}
          >
            {t`Cancel`}
          </Button>
        ) : null}
      </div>
      {file.state === 'uploading' || file.state === 'paused' ? (
        <div className="flex items-center gap-3 ps-7">
          <div
            role="progressbar"
            aria-labelledby={nameId}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraction * 100)}
            className="h-1 flex-1 overflow-hidden rounded-pill bg-hover"
          >
            <span
              className="block h-full w-full origin-left rounded-pill bg-ink-2 transition-transform duration-(--dur-short) ease-(--ease-out)"
              style={{ transform: `scaleX(${fraction})` }}
            />
          </div>
          <span className="shrink-0 type-meta text-ink-2 tabular-nums">
            {speed && left ? t`${speed} a second, about ${left} left` : t`Waiting for the phone`}
          </span>
        </div>
      ) : null}
      {smaller ? (
        <p className="m-0 flex items-start gap-2 ps-7 type-body text-warning-strong">
          <Smartphone aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t`Your iPhone sent a smaller copy of this video. For the original, send it again from the Files app.`}
        </p>
      ) : null}
      {bad && file.error ? (
        <p className="m-0 ps-7 type-body text-ink-2">{errorMessage(i18n, file.error)}</p>
      ) : null}
      {refused ? <ErrorLine error={refused} onRetry={() => void cancel()} className="ps-7" /> : null}
    </div>
  );
}

/** The phone's files in the order they started; rows that arrive after the page opened rise in. */
export function TransferFiles({
  files,
  onCancel,
}: {
  files: readonly TransferFile[];
  onCancel: (id: TransferFile['id']) => Promise<Result<TransferFile> | undefined>;
}) {
  // What was there when the list first showed just shows (DESIGN.md, "Motion rules").
  const initial = useRef<ReadonlySet<TransferFile['id']>>(new Set(files.map((file) => file.id)));
  if (files.length === 0) return null;
  return (
    <ul data-slot="transfer-files" className="m-0 list-none divide-y divide-rule-subtle p-0">
      {files.map((file) => (
        <li key={file.id}>
          <Arrival animate={!initial.current.has(file.id)}>
            <FileRow file={file} onCancel={() => onCancel(file.id)} />
          </Arrival>
        </li>
      ))}
    </ul>
  );
}

/** "2 of 4 in your library": how far the phone's files got, announced as it changes. */
export function LandedCount({ files }: { files: readonly TransferFile[] }) {
  const done = files.filter((file) => file.state === 'imported' || file.state === 'duplicate').length;
  const total = files.length;
  return (
    <p role="status" className="m-0 type-body text-ink-2 tabular-nums">
      <Plural value={done} one={`# of ${total} in your library`} other={`# of ${total} in your library`} />
    </p>
  );
}
