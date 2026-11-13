// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: reel-link-form · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6
 * the paste-a-link field: the label, the field and Read this reel (the Templates screen's one marigold fill), the
 *   platforms that work under it, or what is wrong with what was pasted. Compact (UX3, the Templates page's add
 *   bar): the bar's heading is the field's visible label, so the label is for screen readers; the field leads with
 *   a link icon and shows where a link goes
 * UX4 tpl: Read this reel leads with its verb's glyph (VERB_ICONS.readReel); the field is prose-wide at most
 * states: field default · hover · focus · error (aria-invalid + message) · loading (button); submit is a Button
 *   (eight states); success: the chat opens with the link in its composer
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, cn, Input, VERB_ICONS } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { Link2 } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { openChatWithDraft } from './chat-draft';

/** An http(s) link, or null. Pasted text often has spaces around it. */
export function parseReelLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The field to paste a reel's link: it opens a new chat with the link in the
 * composer, where the agent reads the reel (Templates, first run).
 */
export function ReelLinkForm({
  intro,
  className,
  compact = false,
}: {
  intro?: ReactNode;
  className?: string;
  /** In a bar that names it: no visible label, the field and the button on one line. */
  compact?: boolean;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fieldId = useId();
  const helpId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const link = parseReelLink(value);
    if (!link) {
      setError(t`That isn’t a link. In the app, tap Share, then Copy link, and paste it here.`);
      return;
    }
    setError(null);
    setOpening(true);
    openChatWithDraft(navigate, link);
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className={cn('flex flex-col gap-4', compact ? 'min-w-0' : 'max-w-prose', className)}
    >
      {intro}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className={compact ? 'sr-only' : 'type-label text-ink'}>
          <Trans>Link to a reel</Trans>
        </label>
        <div className="flex flex-wrap gap-2">
          <span className="relative flex min-w-56 flex-1">
            {compact ? (
              <Link2
                aria-hidden
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
              />
            ) : null}
            <Input
              id={fieldId}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              translate="no"
              value={value}
              status={error ? 'error' : undefined}
              aria-describedby={helpId}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) setError(null);
              }}
              placeholder={compact ? t`Paste a link to a reel` : undefined}
              className={cn('w-full', compact && 'ps-9')}
            />
          </span>
          <Button type="submit" variant="primary" icon={VERB_ICONS.readReel} loading={opening}>
            <Trans>Read this reel</Trans>
          </Button>
        </div>
        <p
          id={helpId}
          className={cn('m-0 min-h-[1lh] type-meta', error ? 'text-danger-strong' : 'text-ink-2')}
          role={error ? 'alert' : undefined}
        >
          {error ?? t`Instagram, YouTube and TikTok links all work.`}
        </p>
      </div>
    </form>
  );
}
