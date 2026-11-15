// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: post caption, the fields (CAP1) · system: DESIGN.md v0.7
 * the text to paste under the post, as one plate you can read and type in: who wrote it (violet Taalcut, teal
 *   you) and its length against the platform's limit on the plate's top edge, the text in the middle, and on the
 *   bottom edge what the feed shows before "more". Under the plate, what the platform's rule would flag in the
 *   text, a sentence each with the warning mark (a flag, never a refusal: the text still saves and copies). Then
 *   one line for what the caption should say, and the switch for the credit line. Every number is the rule
 *   table's; nothing here names a kind of video or suggests a word
 * states: none yet (the placeholder says both ways to get one) · saved (Taalcut's, or yours) · typing (your
 *   edit, not saved yet; flags follow each keystroke) · Taalcut writing (read-only, the plate says so) · the chat
 *   busy with other work (read-only) · over the limit (the count turns to the warning ink, with its flag) · the
 *   switch waiting for the app's answer (off-limits until it has it) · the switch's or the save's failure (the
 *   error's sentence, beside what failed)
 * contrast: text-ink on raised, ink-2 for the quiet lines, warning-strong beside its glyph (never colour alone)
 * motion: none of its own (the kit's switch and focus ring); reduced motion: the same
 */
import { useLingui } from '@lingui/react/macro';
import { POST_CAPTION_NOTE_MAX, POST_CAPTION_PLATFORMS, postCaptionRule } from '@taalcut/core';
import {
  AiMark,
  Chip,
  cn,
  CONCEPT_ICONS,
  ErrorLine,
  Glyph,
  Input,
  Segmented,
  Switch,
  UserContent,
} from '@taalcut/ui';
import { useId } from 'react';
import { postCaptionFeedLine, postCaptionIssueWords, postCaptionRuleLine } from './post-caption-words';
import type { PostCaptionState } from './use-post-caption';

/** Who the text in the box is by, on the plate's top edge. */
function Author({ caption }: { caption: PostCaptionState }) {
  const { t } = useLingui();
  if (caption.ask === 'sending' || caption.ask === 'writing')
    return (
      <Chip tone="ai">
        <AiMark className="size-3.5" />
        {t`Taalcut is writing`}
      </Chip>
    );
  if (caption.dirty) return <Chip tone="you">{t`Your edit, not saved yet`}</Chip>;
  if (!caption.saved) return <Chip tone="neutral">{t`No caption yet`}</Chip>;
  return caption.saved.writtenBy === 'ai' ? (
    <Chip tone="ai">
      <AiMark className="size-3.5" />
      {t`Written by Taalcut`}
    </Chip>
  ) : (
    <Chip tone="you">{t`Edited by you`}</Chip>
  );
}

export function PostCaptionBody({ caption }: { caption: PostCaptionState }) {
  const { t, i18n } = useLingui();
  const textId = useId();
  const flagsId = useId();
  const rule = postCaptionRule(caption.platform);
  const over = caption.length > rule.maxLength;
  const flags = caption.issues
    .map((issue) => ({ code: issue.code, words: postCaptionIssueWords(i18n, caption.platform, issue) }))
    .filter((flag): flag is { code: typeof flag.code; words: string } => flag.words !== null);
  const feed = postCaptionFeedLine(caption.platform, caption.draft);
  const length = i18n.number(caption.length);
  const limit = i18n.number(rule.maxLength);
  const credit = rule.credit;
  const several = POST_CAPTION_PLATFORMS.length > 1;
  return (
    <div data-slot="post-caption" className="flex min-w-0 flex-col gap-4">
      <div
        data-slot="post-caption-platform"
        className={cn('flex flex-col items-start', several ? 'gap-1.5' : 'gap-0.5')}
      >
        {several ? (
          <Segmented
            label={t`Where it will be posted`}
            value={caption.platform}
            options={POST_CAPTION_PLATFORMS.map((platform) => ({
              value: platform,
              label: postCaptionRule(platform).name,
            }))}
            onChange={caption.setPlatform}
            disabled={caption.held}
          />
        ) : (
          // One platform in the table: nothing to pick, so it is named, not offered as a choice of one.
          <span className="type-label text-ink">{rule.name}</span>
        )}
        <p className="m-0 min-w-0 type-meta text-ink-2 tabular-nums">
          {postCaptionRuleLine(i18n, caption.platform)}
        </p>
      </div>

      <div
        data-slot="post-caption-plate"
        className={cn(
          'flex min-w-0 flex-col rounded-lg border border-rule-strong bg-raised shadow-xs',
          'transition-[border-color] duration-(--dur-micro) ease-(--ease-out) focus-within:border-ink-2',
        )}
      >
        <div className="flex min-h-9 items-center justify-between gap-3 border-b border-rule-subtle px-3 py-1.5">
          <Author caption={caption} />
          <span
            data-slot="post-caption-count"
            className={cn(
              'type-meta tabular-nums',
              over ? 'font-semibold text-warning-strong' : 'text-ink-3',
            )}
          >
            {t`${length} of ${limit}`}
          </span>
        </div>
        <label htmlFor={textId} className="sr-only">{t`Caption text`}</label>
        <textarea
          id={textId}
          data-slot="post-caption-text"
          translate="no"
          rows={7}
          value={caption.draft}
          readOnly={caption.held}
          aria-busy={caption.ask === 'sending' || caption.ask === 'writing' || undefined}
          aria-describedby={flags.length > 0 ? flagsId : undefined}
          placeholder={
            caption.ask === 'sending' || caption.ask === 'writing'
              ? t`Taalcut is reading the video and writing its caption…`
              : t`Write your own, or let Taalcut write one from what this video shows.`
          }
          onChange={(event) => caption.setDraft(event.target.value)}
          className={cn(
            'block field-sizing-content max-h-80 min-h-40 w-full min-w-0 resize-none border-0 bg-transparent px-3 py-2.5',
            'outline-none',
            'type-body text-ink placeholder:text-ink-3 read-only:text-ink-2',
          )}
        />
        {caption.draft.trim() ? (
          <p
            data-slot="post-caption-feed"
            className="m-0 flex min-w-0 items-baseline gap-2 border-t border-rule-subtle px-3 py-2 type-meta"
          >
            <span className="shrink-0 font-semibold text-ink-2">{t`In the feed`}</span>
            <span className="min-w-0 text-ink-2">
              <UserContent translate="no">{feed.shown}</UserContent>
              {feed.cut ? <span className="text-ink-3"> {t`… more`}</span> : null}
            </span>
          </p>
        ) : null}
      </div>

      {flags.length > 0 ? (
        <div id={flagsId} data-slot="post-caption-flags" role="status" className="flex flex-col gap-1.5">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {flags.map((flag) => (
              <li key={flag.code} data-flag={flag.code} className="flex items-start gap-2 type-meta text-ink">
                <Glyph icon={CONCEPT_ICONS.warning} size="sm" className="mt-0.5 text-warning-strong" />
                <span className="min-w-0">{flag.words}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 pl-6 type-meta text-ink-3">{t`You can still save and copy it as it is.`}</p>
        </div>
      ) : null}

      <label className="flex flex-col gap-1 type-label">
        {t`What should the caption say? (optional)`}
        <Input
          value={caption.note}
          maxLength={POST_CAPTION_NOTE_MAX}
          disabled={caption.held}
          onChange={(event) => caption.setNote(event.target.value)}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <Switch
          checked={caption.credit.on}
          disabled={!caption.credit.ready || caption.held}
          invalid={caption.credit.error !== null}
          onCheckedChange={caption.setCredit}
          label={t`Add “${credit}”`}
          description={t`One line after the caption. Taalcut adds it itself, and remembers your choice.`}
        />
        {caption.credit.error ? <ErrorLine error={caption.credit.error} /> : null}
      </div>
    </div>
  );
}
