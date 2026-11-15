// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: post caption, the dialog (CAP1) · system: DESIGN.md v0.7
 * the caption to paste under the post, for the platform picked: a dialog because it ends in words you take
 *   somewhere else, not in a change to the video. Its fields are post-caption-body.tsx; under them one line that
 *   says how things stand, and the actions. One primary at a time: "Generate with AI" while there is nothing to
 *   copy, "Copy" once there is (the copy's own label is its feedback, as under a chat message). "Generate with AI"
 *   asks the docked chat, which opens behind the dialog and shows the work; the dialog stays, and the caption
 *   lands in it when Taalcut saves it. Closing keeps what you typed: an unsaved edit is saved on the way out
 * states: none yet · saved · your edit (Save appears) · sending to the chat (the button spins) · Taalcut writing
 *   (the line says so; nothing can be changed) · no new caption saved (the line says the chat says why) · the
 *   chat busy with other work · saving · the save failed (the error's sentence) · copied / couldn't copy
 * motion: the dialog's own pop; reduced motion: its fade
 */
import { useLingui } from '@lingui/react/macro';
import type { Timeline } from '@taalcut/core';
import {
  AiMarkIcon,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorLine,
  VERB_ICONS,
} from '@taalcut/ui';
import { PostCaptionBody } from './post-caption-body';
import { usePostCaption, type PostCaptionState } from './use-post-caption';

/** How things stand, in one line under the fields. */
function StatusLine({ caption }: { caption: PostCaptionState }) {
  const { t } = useLingui();
  const hasText = caption.draft.trim() !== '';
  const words =
    caption.ask === 'sending'
      ? t`Sending to the chat…`
      : caption.ask === 'writing'
        ? t`Taalcut is writing your caption. The chat shows its work.`
        : caption.ask === 'unsaved'
          ? t`No new caption was saved. The chat says why.`
          : caption.chatBusy
            ? t`Taalcut is working in the chat. You can ask when it is done.`
            : caption.saving
              ? t`Saving…`
              : caption.dirty
                ? hasText
                  ? t`Not saved yet. It is saved when you copy it or close this.`
                  : t`Save to take the caption off this video, or close to keep it.`
                : caption.saved
                  ? t`Saved with this video.`
                  : t`Taalcut writes it in the chat and saves it here.`;
  return (
    <p
      role="status"
      data-slot="post-caption-status"
      className="m-0 min-w-0 flex-1 basis-44 type-meta text-ink-2"
    >
      {words}
    </p>
  );
}

export interface PostCaptionDialogProps {
  /** The open video: its caption is kept on it. */
  readonly timeline: Timeline;
  readonly open: boolean;
  onOpenChange(open: boolean): void;
}

/** The caption to post under this video: written by Taalcut for a platform, or by you, and copied from here. */
export function PostCaptionDialog({ timeline, open, onOpenChange }: PostCaptionDialogProps) {
  const { t } = useLingui();
  const caption = usePostCaption(timeline, open);
  const hasText = caption.draft.trim() !== '';
  const asking = caption.ask === 'sending';
  const generate = (
    <Button
      type="button"
      variant={hasText ? 'secondary' : 'primary'}
      icon={AiMarkIcon}
      disabled={caption.held && !asking}
      loading={asking}
      onClick={caption.generate}
    >
      {t`Generate with AI`}
    </Button>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // What was typed is never lost on the way out: it is the video's caption now (undo takes it back). An
        // emptied box is not: taking a caption off the video is Save's, said in the line above the buttons.
        if (!next && hasText) void caption.save();
        onOpenChange(next);
      }}
    >
      <DialogContent
        data-slot="post-caption-dialog"
        className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto"
        // The caption is what the dialog is for: the caret starts in it, not on the first control.
        onOpenAutoFocus={(event) => {
          const text = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
            '[data-slot="post-caption-text"]',
          );
          if (!text) return;
          event.preventDefault();
          text.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t`Post caption`}</DialogTitle>
          <DialogDescription>
            {t`The text you paste under the post. Taalcut writes it from what this video shows, and you can change any of it.`}
          </DialogDescription>
        </DialogHeader>
        <PostCaptionBody caption={caption} />
        {caption.error ? <ErrorLine error={caption.error} onRetry={() => void caption.save()} /> : null}
        <DialogFooter className="items-center gap-x-4 gap-y-3">
          <StatusLine caption={caption} />
          {/* The buttons stay together: with no room beside the line, they take the next row. */}
          <div className="flex shrink-0 items-center gap-2">
            {caption.dirty && !caption.held ? (
              <Button
                type="button"
                variant="ghost"
                loading={caption.saving}
                onClick={() => void caption.save()}
              >
                {t`Save`}
              </Button>
            ) : null}
            {generate}
            {hasText ? (
              <Button
                type="button"
                variant="primary"
                icon={VERB_ICONS.copy}
                status={
                  caption.copied === 'copied' ? 'success' : caption.copied === 'failed' ? 'error' : undefined
                }
                onClick={caption.copy}
              >
                {caption.copied === 'copied'
                  ? t`Copied`
                  : caption.copied === 'failed'
                    ? t`Couldn’t copy`
                    : t`Copy`}
              </Button>
            ) : null}
            <span role="status" className="sr-only">
              {caption.copied === 'copied' ? t`Copied` : ''}
            </span>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
