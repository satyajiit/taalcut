// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the last step, paste a reel (UX4) · genre: atmospheric studio app · system: DESIGN.md v0.6 +
 *   _orch/ux4/specs/design-onb.md
 * the reel's link field (its label above, what works under it) and the file way in for a screen recording; no button
 *   of its own: the step's one primary, Make my first video, reads it (Return in the field presses it too).
 * states: field default · hover · focus (base ring) · error (aria-invalid + the line under it, alert) · disabled
 *   (Local only: the link is off and says why, the file stays) · a file chosen (its name, announced) · picking (the
 *   file button spins) · picking failed (ErrorLine)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type TaalcutError } from '@taalcut/core';
import { Button, ErrorLine, Input, UserContent, VERB_ICONS, cn } from '@taalcut/ui';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useBackend } from '../../../backend/backend';

/** An https link (what Share → Copy link gives), or null. */
export function parseReelLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A screen recording of the reel, picked from disk. */
export interface ReelFile {
  readonly path: string;
  readonly name: string;
}

export interface ReelPanelProps {
  readonly link: string;
  onLink(value: string): void;
  readonly file: ReelFile | null;
  onFile(file: ReelFile): void;
  /** Why the link is wrong, after a press: the line under the field says it. */
  readonly wrong: string | null;
  /** Why the link is off (Local only), already in words; the file way stays. */
  readonly linkOff?: string | undefined;
  readonly disabled: boolean;
  /** Return in the field: the step's primary. */
  onSubmit(): void;
}

export function ReelPanel({
  link,
  onLink,
  file,
  onFile,
  wrong,
  linkOff,
  disabled,
  onSubmit,
}: ReelPanelProps) {
  const { t } = useLingui();
  const backend = useBackend();
  const field = useId();
  const help = useId();
  const input = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [failed, setFailed] = useState<TaalcutError | null>(null);
  const recording = file?.name;
  // Opening Paste a reel is asking to paste: the caret goes to the field (not with the link off).
  useEffect(() => {
    if (!linkOff) input.current?.focus();
  }, [linkOff]);
  useEffect(() => {
    if (wrong) input.current?.focus();
  }, [wrong]);

  const pick = async () => {
    setFailed(null);
    setPicking(true);
    const picked = await callRpc(backend.files.pickFile({ purpose: 'reference' }));
    setPicking(false);
    if (!picked.ok) return setFailed(picked.error);
    if (!picked.value) return;
    const { path } = picked.value;
    onFile({ path, name: path.split('/').pop() ?? path });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div data-slot="reel-panel" className="flex flex-col gap-4">
      <form noValidate onSubmit={submit} className="flex flex-col gap-1.5">
        <label htmlFor={field} className="type-label text-ink">
          <Trans>Link to a reel</Trans>
        </label>
        <Input
          ref={input}
          id={field}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          translate="no"
          value={link}
          disabled={disabled || Boolean(linkOff)}
          status={wrong ? 'error' : undefined}
          aria-describedby={help}
          onChange={(event) => onLink(event.target.value)}
          className="w-full max-w-prose"
        />
        <p
          id={help}
          role={wrong ? 'alert' : undefined}
          className={cn('m-0 min-h-[1lh] type-meta', wrong ? 'text-danger-strong' : 'text-ink-2')}
        >
          {wrong ?? linkOff ?? t`Instagram, YouTube and TikTok links all work.`}
        </p>
      </form>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-rule-subtle pt-4">
        <p className="m-0 type-body text-ink-2">
          <Trans>Or use a screen recording of it:</Trans>
        </p>
        <Button
          variant="secondary"
          size="sm"
          icon={VERB_ICONS.import}
          loading={picking}
          disabled={disabled}
          onClick={() => void pick()}
          data-action="pick-reel-file"
        >
          <Trans>Choose a file…</Trans>
        </Button>
      </div>
      <p role="status" className="m-0 type-body text-ink-2 empty:hidden">
        {recording && !link.trim() ? (
          <Trans>
            Taalcut follows the recording <UserContent translate="no">{recording}</UserContent>.
          </Trans>
        ) : null}
      </p>
      {failed ? <ErrorLine error={failed} /> : null}
    </div>
  );
}
