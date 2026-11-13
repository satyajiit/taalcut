// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Add the credit (BRK1-REV, the reel's sound) · system: DESIGN.md v0.7
 * when the breakdown found no credit for the reel's sound, the review asks for one in place: the sound's title, who
 *   made it, and an optional https link (as a pasted reel's link is). Save writes template.setSoundCredit, which
 *   answers the doubt and undoes like any fix; Cancel or Escape puts the question back
 * states: default (the first field focused) · error (aria-invalid and the line under the fields: neither title nor
 *   artist, or a link that isn't https; typing in that field takes it away) · saving (Save spins, the fields wait) · failed (the panel's error line)
 */
import { useLingui } from '@lingui/react/macro';
import type { SoundCredit } from '@taalcut/core';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '#components/button';
import { Input } from '#components/input';
import { REVIEW_ICONS } from './review-icons';

/** An https link, or null (what the contract takes: `soundUrlSchema`). */
export function parseSoundUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export interface SoundCreditFormProps {
  /** What the template credits now (`audio.sound`), to start from. */
  initial: {
    readonly title: string | null;
    readonly artist: string | null;
    readonly url?: string | null;
  } | null;
  saving: boolean;
  /** True when the credit was written. */
  onSave: (credit: SoundCredit) => Promise<boolean>;
  onCancel: () => void;
}

export function SoundCreditForm({ initial, saving, onSave, onCancel }: SoundCreditFormProps) {
  const { t } = useLingui();
  const id = useId();
  const first = useRef<HTMLInputElement>(null);
  const self = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [artist, setArtist] = useState(initial?.artist ?? '');
  const [link, setLink] = useState(initial?.url ?? '');
  const [wrong, setWrong] = useState<{ field: 'title' | 'link'; words: string } | null>(null);
  // The whole form comes into the panel's view, Save with it, and the caret goes to the title.
  useEffect(() => {
    self.current?.scrollIntoView?.({ block: 'nearest' });
    first.current?.focus({ preventScroll: true });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const named = { title: title.trim(), artist: artist.trim() };
    if (!named.title && !named.artist)
      return setWrong({ field: 'title', words: t`Give the sound’s title, who made it, or both.` });
    const url = link.trim() ? parseSoundUrl(link) : null;
    if (link.trim() && !url)
      return setWrong({ field: 'link', words: t`That isn’t a link. Paste one that starts with https://` });
    setWrong(null);
    await onSave({
      ...(named.title ? { title: named.title } : {}),
      ...(named.artist ? { artist: named.artist } : {}),
      ...(url ? { url } : {}),
    });
  };
  const invalid = (field: 'title' | 'link') =>
    wrong?.field === field ? { 'aria-describedby': `${id}-wrong` } : {};

  return (
    <form
      ref={self}
      data-slot="sound-credit-form"
      aria-label={t`The sound’s credit`}
      className="flex flex-col gap-2"
      // The link is checked here, in words, rather than by the browser's own bubble.
      noValidate
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onCancel();
      }}
    >
      <div className="grid grid-cols-1 gap-2 @[24rem]:grid-cols-2">
        <label className="flex flex-col gap-1 type-label text-ink">
          {t`Title`}
          <Input
            ref={first}
            value={title}
            maxLength={200}
            disabled={saving}
            status={wrong?.field === 'title' ? 'error' : undefined}
            onChange={(event) => {
              setTitle(event.target.value);
              if (wrong?.field === 'title') setWrong(null);
            }}
            {...invalid('title')}
          />
        </label>
        <label className="flex flex-col gap-1 type-label text-ink">
          {t`Artist`}
          <Input
            value={artist}
            maxLength={200}
            disabled={saving}
            onChange={(event) => {
              setArtist(event.target.value);
              if (wrong?.field === 'title') setWrong(null);
            }}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 type-label text-ink">
        {t`Link to the sound (optional)`}
        <Input
          type="url"
          inputMode="url"
          value={link}
          maxLength={2048}
          disabled={saving}
          placeholder="https://"
          status={wrong?.field === 'link' ? 'error' : undefined}
          onChange={(event) => {
            setLink(event.target.value);
            if (wrong?.field === 'link') setWrong(null);
          }}
          {...invalid('link')}
        />
      </label>
      {wrong ? (
        <p id={`${id}-wrong`} role="alert" className="m-0 type-meta text-danger-strong">
          {wrong.words}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="primary" icon={REVIEW_ICONS.credit} loading={saving}>
          {t`Save the credit`}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          {t`Cancel`}
        </Button>
      </div>
    </form>
  );
}
