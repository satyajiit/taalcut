// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: opening choice, paste a reel · genre: atmospheric studio app · system: DESIGN.md v0.3
 * the reel's link field and the file way in, under the choice; the whole panel takes a dropped video
 * states: field default · hover · focus (base ring) · error (aria-invalid + the line under it) · disabled (Local only:
 *   the link is off and says why, the file stays) · loading (Read this reel / Choose a file spin while the flow
 *   starts) · drag-over (marigold rule on the panel, selected wash) · success (the chat takes over)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { ReferenceInput, TaalcutError } from '@taalcut/core';
import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Button } from '#components/button';
import { Input } from '#components/input';
import { cn } from '#lib/cn';
import { useCardActions } from './card-actions';
import { ErrorLine } from './error-line';
import { VERB_ICONS } from '../icons/concepts';

/** An https link (what Share → Copy link gives), or null. */
export function parseReelUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const VIDEO = /\.(mov|mp4|m4v|webm)$/i;

export interface OpeningReelProps {
  /** Why the link is off (Local only), already in words; the file way stays. */
  linkOff?: string | undefined;
  disabled: boolean;
  onStart: (reference: ReferenceInput, label: string) => Promise<TaalcutError | null>;
}

/** Paste a reel's link, or pick or drop a file you recorded. */
export function OpeningReel({ linkOff, disabled, onStart }: OpeningReelProps) {
  const { t } = useLingui();
  const actions = useCardActions();
  const field = useId();
  const help = useId();
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState<'link' | 'file' | null>(null);
  const [failed, setFailed] = useState<TaalcutError | null>(null);
  const [dragging, setDragging] = useState(false);
  const canDrop = Boolean(actions.pathForFile);
  const input = useRef<HTMLInputElement>(null);
  // Opening Paste a reel is asking to paste: the caret goes to the field (not with the link off).
  const focusOnOpen = !linkOff;
  useEffect(() => {
    if (focusOnOpen) input.current?.focus();
  }, [focusOnOpen]);

  const start = async (kind: 'link' | 'file', reference: ReferenceInput, label: string) => {
    setBusy(kind);
    setFailed(null);
    const error = await onStart(reference, label);
    setBusy(null);
    if (error) setFailed(error);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (linkOff || busy) return;
    const url = parseReelUrl(value);
    if (!url) {
      setWrong(t`That isn’t a link. In the app, tap Share, then Copy link, and paste it here.`);
      return;
    }
    setWrong(null);
    void start('link', { kind: 'link', url }, url);
  };

  const pick = async () => {
    if (!actions.pickFile) return;
    setFailed(null);
    setBusy('file');
    const picked = await actions.pickFile('reference');
    if (!picked.ok) {
      setBusy(null);
      setFailed(picked.error);
      return;
    }
    if (!picked.value) return setBusy(null);
    const path = picked.value.path;
    await start('file', { kind: 'file', path }, path.split('/').pop() ?? path);
  };

  const over = (event: DragEvent) => {
    if (!canDrop || disabled) return;
    event.preventDefault();
    setDragging(true);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = [...event.dataTransfer.files].find((each) => VIDEO.test(each.name));
    const path = file ? actions.pathForFile?.(file) : null;
    if (!file || !path) {
      setWrong(t`Drop a video file: a screen recording of the reel works.`);
      return;
    }
    void start('file', { kind: 'file', path }, file.name);
  };

  return (
    <div
      data-slot="opening-reel"
      data-dragging={dragging || undefined}
      onDragEnter={over}
      onDragOver={over}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={drop}
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-transparent p-3',
        'transition-colors duration-(--dur-micro) ease-(--ease-out)',
        'data-dragging:border-primary-strong data-dragging:bg-selected',
      )}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-1.5">
        <label htmlFor={field} className="text-sm font-medium text-ink">
          <Trans>Link to a reel</Trans>
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            ref={input}
            id={field}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            translate="no"
            value={value}
            disabled={disabled || Boolean(linkOff)}
            status={wrong ? 'error' : undefined}
            aria-describedby={help}
            onChange={(event) => {
              setValue(event.target.value);
              if (wrong) setWrong(null);
            }}
            className="min-w-48 flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            icon={VERB_ICONS.readReel}
            loading={busy === 'link'}
            disabled={disabled || Boolean(linkOff) || busy === 'file'}
          >
            <Trans>Read this reel</Trans>
          </Button>
        </div>
        <p
          id={help}
          role={wrong ? 'alert' : undefined}
          className={cn('m-0 min-h-[1lh] text-sm', wrong ? 'text-danger-strong' : 'text-ink-2')}
        >
          {wrong ?? linkOff ?? t`Instagram, YouTube and TikTok links all work.`}
        </p>
      </form>
      {actions.pickFile ? (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
          {canDrop ? (
            <Trans>Or drop a screen recording of it here, or</Trans>
          ) : (
            <Trans>Or use a screen recording of it:</Trans>
          )}
          <Button
            variant="ghost"
            size="sm"
            loading={busy === 'file'}
            disabled={disabled || busy === 'link'}
            onClick={() => void pick()}
          >
            <Trans>Choose a file…</Trans>
          </Button>
        </p>
      ) : null}
      {failed ? <ErrorLine error={failed} /> : null}
    </div>
  );
}
