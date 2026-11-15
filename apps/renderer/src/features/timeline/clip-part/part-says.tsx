// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: what the part's control says (TRIM1) · system: DESIGN.md v0.7 (plain words;
 *   a problem said once, where the hand is, with what still works)
 * the lines under the steps: at rest, what dragging does and (truthfully) what the scenes next to this one do;
 *   while an end moves, how long the scene would last, who makes room and why it goes no further; while the part
 *   moves, that letting go plays it and Escape puts it back; after a refusal, why. Then the file's own troubles:
 *   it couldn't be read (with Try again), its original is away, it has no frames to lay out
 * states: rest · moving the part · moving an end · locked · refused (role="alert") · unreadable · original away ·
 *   no frames
 * motion: none
 */
import { useLingui } from '@lingui/react/macro';
import type { AssetDetail } from '@taalcut/core';
import { Button, cn, CONCEPT_ICONS, VERB_ICONS } from '@taalcut/ui';
import { stateLine } from '../../library/clip/scrubber/clip-filmstrip';
import { filmstripState } from '../../library/clip/scrubber/filmstrip-state';
import type { PartWords } from './part-words';
import type { PartGestures } from './use-part-gestures';

const LINE = 'm-0 type-meta text-ink-2';

export interface PartSaysProps {
  id: string;
  words: PartWords;
  gestures: PartGestures;
  locked: boolean;
  /** The file's detail: undefined while it loads, null when it couldn't be read. */
  detail: AssetDetail | null | undefined;
  /** Whether the file's filmstrip is drawn. */
  drawn: boolean;
  onRetry(): void;
}

export function PartSays({ id, words, gestures, locked, detail, drawn, onRetry }: PartSaysProps) {
  const { t, i18n } = useLingui();
  const { gesture } = gestures;
  const live = gesture !== null && gestures.by !== 'sent';
  // A filmstrip the library has and the page can't load is one that didn't load.
  const state = detail && !drawn ? filmstripState(detail) : null;
  const noFrames = state ? stateLine(i18n, state.kind === 'drawn' ? { kind: 'broken' } : state) : null;
  const away = detail && detail.asset.availability !== 'online';
  const Offline = CONCEPT_ICONS.offline;
  const Problem = CONCEPT_ICONS.error;
  return (
    <div id={id} data-slot="part-says" className="flex min-h-16 flex-col gap-1">
      {gestures.refusal ? (
        <p role="alert" className="m-0 flex items-start gap-1.5 type-meta text-ink">
          <Problem aria-hidden className="mt-px size-3.5 shrink-0 text-danger-strong" />
          {words.refused(gestures.refusal)}
        </p>
      ) : null}
      {live && gesture !== 'move' ? (
        words.resizing(gesture, gestures.trim, gestures.stop).map((line) => (
          <p key={line} className={cn(LINE, 'tabular-nums')}>
            {line}
          </p>
        ))
      ) : gestures.by === 'pointer' ? (
        <p className={LINE}>{t`Let go to play this part. Escape puts it back.`}</p>
      ) : locked ? (
        <p className={LINE}>{t`Locked: Taalcut and your edits leave it as it is. Unlock it to change it.`}</p>
      ) : (
        words.rest().map((line) => (
          <p key={line} className={LINE}>
            {line}
          </p>
        ))
      )}
      {detail === null ? (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-meta text-ink">
          <Problem aria-hidden className="size-3.5 shrink-0 text-danger-strong" />
          {t`Taalcut couldn’t read this clip, so its frames don’t show. The steps and the exact trim still work.`}
          <Button size="sm" variant="ghost" icon={VERB_ICONS.retry} onClick={onRetry}>
            {t`Try again`}
          </Button>
        </p>
      ) : null}
      {away ? (
        <p data-slot="part-away" className={cn(LINE, 'flex items-start gap-1.5')}>
          <Offline aria-hidden className="mt-px size-3.5 shrink-0 text-ink-3" />
          {t`This clip’s original isn’t connected right now. You can still pick the part; connect it before you export.`}
        </p>
      ) : null}
      {noFrames ? (
        <p data-slot="part-no-frames" className={cn(LINE, 'flex items-start gap-1.5')}>
          {noFrames[0]}
          <span>
            {noFrames[1]} {t`The part still moves: go by its times.`}
          </span>
        </p>
      ) : null}
    </div>
  );
}
