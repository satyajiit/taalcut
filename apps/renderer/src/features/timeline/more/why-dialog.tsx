// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Why this shot (MORE1) · system: DESIGN.md v0.7 (violet the AI, teal you,
 *   each with its words)
 * a dialog that answers one question about a scene: the shot's picture and its file's name, what the template
 *   asks for in that place, who picked the shot (Taalcut, with how sure it was, or you) and what Taalcut saw in
 *   it. Nothing here changes the video: the dialog's own close, or Escape, is the one way out
 * states: the AI's pick (its mark, its confidence) · your pick ("You") · nobody's (no cast: said) · no ask (a
 *   video not made from a template: the line is left out) · the picture still loading (the viewer grey)
 * motion: the dialog's own pop; reduced motion: its fade
 */
import { useLingui } from '@lingui/react/macro';
import {
  AiMarkIcon,
  Confidence,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SHOT_TYPE_LABELS,
  ShotThumb,
  UserContent,
} from '@taalcut/ui';
import type { ReactNode } from 'react';
import { mediaOf, type ClipView } from '../model';
import type { ShotLookup } from '../shot-frames';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="type-meta text-ink-2">{label}</dt>
      <dd className="m-0 type-body text-ink">{children}</dd>
    </div>
  );
}

export interface WhyDialogProps {
  clip: ClipView;
  lookup: ShotLookup;
  onOpenChange(open: boolean): void;
}

export function WhyDialog({ clip, lookup, onOpenChange }: WhyDialogProps) {
  const { t, i18n } = useLingui();
  const media = mediaOf(clip.item);
  const pick = lookup.frameNow(media.assetId, media.shotId);
  const ask = clip.slot?.intent.text?.trim() ? clip.slot.intent.text : null;
  const shotType = clip.slot?.intent.shotType;
  const kind = shotType ? i18n._(SHOT_TYPE_LABELS[shotType]) : null;
  const number = i18n.number(clip.number);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-slot="why-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t`Why this shot`}</DialogTitle>
          <DialogDescription>{kind ? t`Scene ${number} · ${kind}` : t`Scene ${number}`}</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-4" data-slot="clip-pick">
          <ShotThumb url={pick?.url} size="lg" className="mb-1.5" />
          <dl className="m-0 flex min-w-0 flex-1 flex-col gap-3">
            <Fact label={t`Who picked it`}>
              {clip.chosenBy === 'ai' ? (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <AiMarkIcon aria-hidden className="size-4 text-ai-strong" />
                    {t`Taalcut picked this`}
                  </span>
                  {clip.cast ? (
                    <Confidence value={clip.cast.confidence} reranked={clip.cast.note === 'reranked'} />
                  ) : null}
                </span>
              ) : clip.chosenBy === 'you' ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="rounded-sm bg-you-soft px-1 type-caption text-you-strong">{t`You`}</span>
                  {t`You changed this`}
                </span>
              ) : (
                t`There is no record of who picked this shot.`
              )}
            </Fact>
            {ask ? (
              <Fact label={t`The template asks for`}>
                <UserContent>{ask}</UserContent>
              </Fact>
            ) : null}
            {pick ? (
              <Fact label={t`The shot`}>
                <UserContent translate="no" className="block break-words font-medium">
                  {pick.name}
                </UserContent>
                {pick.description ? (
                  <UserContent className="block text-ink-2">{pick.description}</UserContent>
                ) : null}
              </Fact>
            ) : null}
          </dl>
        </div>
      </DialogContent>
    </Dialog>
  );
}
