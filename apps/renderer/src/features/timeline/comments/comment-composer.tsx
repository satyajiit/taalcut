// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: comment composer · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a small dialog over the editor: what the comment is on ("Clip 2 · at 0:04") as its title, the words, Cancel and
 *   Add comment; opened from the inspector, an item's menu, C or the viewer's Comment here; the new comment's pin
 *   shows on the bed and it joins the dock's Comments, open
 * states: default · saving (the button spins, the field rests) · error (the cause under the field; the words stay)
 *   · empty words (Add comment off, with why) · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { COMMENT_COMMANDS, editTargetSpan, newId, type TaalcutError, type Timeline } from '@taalcut/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorLine,
} from '@taalcut/ui';
import { useState } from 'react';
import { useCommand } from '../../../backend/use-command';
import { atRate } from '../model';
import { CommentField } from './comment-field';
import { commentOnRequests, useClaim, type CommentOn } from './comment-requests';
import { useCommentWords } from './comment-words';

export function CommentComposer({ timeline }: { timeline: Timeline }) {
  const [request, setRequest] = useState<CommentOn | null>(null);
  useClaim(commentOnRequests, setRequest);
  if (!request) return null;
  return (
    <ComposerDialog
      key={JSON.stringify(request)}
      timeline={timeline}
      request={request}
      onClose={() => setRequest(null)}
    />
  );
}

function ComposerDialog({
  timeline,
  request,
  onClose,
}: {
  timeline: Timeline;
  request: CommentOn;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const words = useCommentWords(timeline);
  const { run, pending } = useCommand({ toast: false });
  const [body, setBody] = useState('');
  const [error, setError] = useState<TaalcutError | null>(null);
  const rate = timeline.canvas.rate;
  const span = editTargetSpan(timeline, request.target);
  const on = words.target(request.target);
  const at =
    request.at !== undefined && span && request.at > 0 && request.at < span.end - span.start
      ? request.at
      : undefined;

  const save = async () => {
    if (!body.trim() || pending) return;
    const result = await run({
      name: COMMENT_COMMANDS.add,
      payload: {
        projectId: timeline.projectId,
        timelineId: timeline.id,
        commentId: newId<'TimelineComment'>(),
        anchor: request.target,
        ...(at !== undefined ? { at: atRate(at, rate) } : {}),
        body: body.trim(),
      },
    });
    if (result.ok) onClose();
    else setError(result.error);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md" data-slot="comment-composer">
        <DialogHeader>
          <DialogTitle>
            {request.target.kind === 'timeline' ? t`Comment on the whole video` : t`Comment on ${on}`}
          </DialogTitle>
          <DialogDescription>
            {t`Say what you’d change. Comments wait in the Comments tab until you send them to Taalcut together.`}
          </DialogDescription>
        </DialogHeader>
        <CommentField
          label={t`Your comment`}
          value={body}
          onChange={setBody}
          onSubmit={() => void save()}
          disabled={pending}
          autoFocus
          // The line stays (empty) once there are words, so the dialog doesn't jump.
          hint={body.trim() ? '' : t`Write what you’d change first.`}
        />
        {error ? <ErrorLine error={error} /> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t`Cancel`}
          </Button>
          <Button disabled={!body.trim()} loading={pending} onClick={() => void save()}>
            {t`Add comment`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
