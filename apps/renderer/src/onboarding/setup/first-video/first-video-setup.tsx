// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the last step, make your first video (UX4: the finish) · genre: atmospheric studio app (brand moment) ·
 *   system: DESIGN.md v0.6 + _orch/ux4/specs/design-onb.md
 * the step's Kaatu moment first (what the quiet checks need, else a tip, then a grin once it's ready); then the ways
 *   to start as choice tiles (Paste a reel first, then Pick a starter, then Just describe it), the chosen one's panel
 *   in a full-width row under them. Choosing fills in the finish; the step's one primary, Make my first video, in the
 *   actions row, starts it: first run is done, and a chat opens with it as the first message.
 * states: nothing chosen (the primary off, its reason under it) · a way open (its panel's own) · ready (the grin, the
 *   primary on) · starting (the primary spins; the ways wait) · failed (the cause in the way's panel) · nothing can
 *   think (the moment's fix; the primary off until a way works) · resume (the starter picker open again)
 */
import { useLingui } from '@lingui/react/macro';
import {
  newId,
  type ChatStart,
  type OnboardingBranch,
  type OnboardingProgress,
  type TaalcutError,
} from '@taalcut/core';
import {
  CONCEPT_ICONS,
  ErrorLine,
  Glyph,
  OPENING_WORDS,
  openingReason,
  type StarterChoice,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { sendWhenOpen } from '../../../chat/handoff';
import { addStarterTemplate } from '../../../chat/starter-actions';
import { useFinishGate } from '../../finish-gate';
import { markFirstExportStart } from '../../first-export';
import { QuietCheckFix, QuietCheckMoment, useQuietCheck } from '../../quiet-checks';
import { StepMoment } from '../../step-screen';
import { DescribePanel } from './describe-panel';
import { FinishMoment, type FinishReady } from './finish-moment';
import { FinishTiles, type FinishWay } from './finish-tiles';
import { parseReelLink, ReelPanel, type ReelFile } from './reel-panel';
import { StarterPicker, useStarterChoices } from './starter-picker';

/** What the person has put in, per way. */
interface Choice {
  readonly link: string;
  readonly file: ReelFile | null;
  readonly starter: StarterChoice | null;
  readonly words: string;
}

/** What the finish would start now, or null. */
function readyFor(open: FinishWay | null, choice: Choice): FinishReady | null {
  if (open === 'reference') {
    if (choice.link.trim()) return { kind: 'link' };
    if (choice.file) return { kind: 'file', name: choice.file.name };
  }
  if (open === 'template' && choice.starter) return { kind: 'starter', name: choice.starter.name };
  if (open === 'describe' && choice.words.trim()) return { kind: 'describe' };
  return null;
}

/** Starts a chat with the first message and finishes first run. */
function useBegin(onStart: () => Promise<unknown>) {
  const navigate = useNavigate();
  return async (start: ChatStart, text: string) => {
    await onStart();
    markFirstExportStart(
      start.path === 'template' ? 'template' : start.path === 'reference' ? 'reference' : 'describe',
    );
    const conversationId = newId<'Conversation'>();
    sendWhenOpen(conversationId, text, undefined, start);
    await navigate({ to: '/chat/$conversationId', params: { conversationId } });
  };
}

export function FirstVideoSetup({
  onStart,
  branch,
  onChoose,
}: {
  /** First run is finished (saved, the sound): the caller's. */
  onStart: () => Promise<unknown>;
  /** Where inside the step the person was last time. */
  branch?: OnboardingProgress['branch'] | undefined;
  onChoose: (branch: OnboardingBranch) => void;
}) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const privacy = useRpcQuery((signal) => backend.privacy.overview(undefined, { signal }), [backend]);
  const check = useQuietCheck(branch?.thinking);
  const need = check.need;
  const starters = useStarterChoices();
  const begin = useBegin(onStart);
  const [open, setOpen] = useState<FinishWay | null>(branch?.starterPicker ? 'template' : null);
  const [choice, setChoice] = useState<Choice>({ link: '', file: null, starter: null, words: '' });
  const [wrong, setWrong] = useState<string | null>(null);
  const [failed, setFailed] = useState<TaalcutError | null>(null);
  const [busy, setBusy] = useState(false);
  // A way to think that starts working while the step is open is said, once, before the choice is.
  const thinking = useRef(need === 'thinking');
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (need === 'thinking') thinking.current = true;
    else if (thinking.current && need === null) setConnected(true);
  }, [need]);

  // The best fit is chosen for you when the starters arrive: a default that works.
  const list = starters.starters;
  useEffect(() => {
    if (Array.isArray(list) && list[0] && !choice.starter)
      setChoice((now) => ({ ...now, starter: list[0] ?? null }));
  }, [list, choice.starter]);

  const ready = readyFor(open, choice);
  const linkOff = privacy.data?.localOnly ? openingReason(i18n, 'opening.reference.localOnly') : undefined;

  const go = async () => {
    if (!ready || busy) return;
    setFailed(null);
    if (ready.kind === 'link') {
      const url = parseReelLink(choice.link);
      if (!url)
        return setWrong(t`That isn’t a link. In the app, tap Share, then Copy link, and paste it here.`);
      setBusy(true);
      // The chat start's own words for a reel (opening-panel.tsx), so the first message reads the same either way.
      const label = url;
      return begin(
        { path: 'reference', reference: { kind: 'link', url } },
        t`Make a video like this reel: ${label}`,
      );
    }
    setBusy(true);
    if (ready.kind === 'file' && choice.file) {
      const { path, name: label } = choice.file;
      return begin(
        { path: 'reference', reference: { kind: 'file', path } },
        t`Make a video like this reel: ${label}`,
      );
    }
    if (ready.kind === 'starter' && choice.starter) {
      const added = await addStarterTemplate(backend, choice.starter.starterId);
      if (!added.ok) {
        setBusy(false);
        return setFailed(added.error);
      }
      const name = choice.starter.name;
      return begin(
        { path: 'template', templateId: added.value.templateId },
        t`Make a video with the “${name}” starter`,
      );
    }
    return begin({ path: 'describe' }, choice.words.trim());
  };

  useFinishGate(
    {
      ready: ready !== null && need !== 'thinking',
      reason:
        need === 'thinking'
          ? t`Choose how Taalcut thinks first.`
          : t`Paste a reel’s link, pick a starter or describe your video first.`,
      busy,
    },
    () => void go(),
  );

  const choose = (way: FinishWay | null) => {
    setOpen(way);
    setWrong(null);
    setFailed(null);
    onChoose({ starterPicker: way === 'template' });
  };
  const ways = [
    {
      id: 'reference' as const,
      icon: <Glyph icon={CONCEPT_ICONS.reel} size="lg" />,
      title: i18n._(OPENING_WORDS.reference.name),
      line: i18n._(OPENING_WORDS.reference.line),
      panel: (
        <ReelPanel
          link={choice.link}
          onLink={(link) => {
            setWrong(null);
            setChoice((now) => ({ ...now, link }));
          }}
          file={choice.file}
          onFile={(file) => setChoice((now) => ({ ...now, file, link: '' }))}
          wrong={wrong}
          linkOff={linkOff}
          disabled={busy}
          onSubmit={() => void go()}
        />
      ),
    },
    {
      id: 'template' as const,
      icon: <Glyph icon={CONCEPT_ICONS.template} size="lg" />,
      title: t({ id: 'onboarding.finish.starter.title', message: 'Pick a starter' }),
      line: t({
        id: 'onboarding.firstVideo.starter.body',
        message: 'No reel needed. Pick a shape, and Taalcut fills it with your clips.',
      }),
      panel: (
        <StarterPicker
          starters={starters.starters}
          chosen={choice.starter?.starterId ?? null}
          onChoose={(starter) => setChoice((now) => ({ ...now, starter }))}
          onRetry={starters.retry}
          disabled={busy}
        />
      ),
    },
    {
      id: 'describe' as const,
      icon: <Glyph icon={CONCEPT_ICONS.chat} size="lg" />,
      title: i18n._(OPENING_WORDS.describe.name),
      line: i18n._(OPENING_WORDS.describe.line),
      panel: (
        <DescribePanel
          words={choice.words}
          onWords={(words) => setChoice((now) => ({ ...now, words }))}
          disabled={busy}
          onSubmit={() => void go()}
        />
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-8">
      <StepMoment>
        {need ? (
          <QuietCheckMoment check={{ ...check, need }} />
        ) : (
          <FinishMoment ready={ready} connected={connected} />
        )}
        <QuietCheckFix check={check} resume={branch?.thinking} onChoose={onChoose} />
      </StepMoment>
      <FinishTiles label={t`Ways to start`} ways={ways} open={open} onOpen={choose} disabled={busy} />
      {failed ? <ErrorLine error={failed} /> : null}
    </div>
  );
}
