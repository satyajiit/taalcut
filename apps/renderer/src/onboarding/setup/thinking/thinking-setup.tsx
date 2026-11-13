// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: onboarding, how Taalcut thinks · genre: atmospheric studio app · system: DESIGN.md v0.4
 * the four ways of PRD 9.1 as rows (ChatGPT first, Recommended; another subscription behind its warning; an API key;
 *   Local only), each leading to a working model; a way that works says so on its row. The profile list follows,
 *   folded under "Choose a profile", already set by the way chosen. Continue waits for a way that works.
 * states: loading (skeleton rows) · error (LoadError) · default · the profile list folded (a chevron that turns
 *   when it opens, v0.4, UX1: no ▶ marker) · a sign-in waiting · signed in (announced) ·
 *   failed (ErrorLine with the fix) · offline (the cloud ways say why; Local only stays) · Local only on from
 *   before (its row shows it chosen) · resume (the way chosen last time opens)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import {
  MODEL_COMMANDS,
  type AccountsState,
  type ModelSettings,
  type OnboardingBranch,
  type PrivacyOverview,
  type WarnedLogin,
} from '@taalcut/core';
import { SkeletonLines, cn } from '@taalcut/ui';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCommand } from '../../../backend/use-command';
import { ProfilePicker } from '../../../features/settings/models/profile-picker';
import { LoadError } from '../../../features/settings/fields';
import { useStepGate } from '../../step-gate';
import { useOnline } from '../../../features/shared/use-online';
import { WayList } from '../way-list';
import { LOCAL_ONLY_PROFILE } from './local-only-way';
import { thinkingWorks, useThinkingData, type ThinkingWorks } from './thinking-state';
import { useThinkingWays, type ThinkingWay } from './thinking-ways';

/** The safer key for each warned plan (the warning card's one tap). */
const SAFER_KEY: Record<WarnedLogin, string> = {
  anthropic: 'anthropic',
  xai: 'xai',
  'github-copilot': 'openai',
};
/** The profile a cloud way starts with (DESIGN.md: "Balanced" is called Everyday). */
const CLOUD_PROFILE = 'balanced';

type Command = ReturnType<typeof useCommand>;

/** The profile list, folded under "Choose a profile", already set by the way chosen. */
function ProfileChoice({ models, command }: { models: ModelSettings; command: Command }) {
  return (
    <details className="group border-t border-rule-subtle pt-4">
      {/* Our own chevron, turning on transform, in place of the browser's ▶ marker (v0.4, UX1). */}
      <summary
        className={cn(
          'flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium text-ink-2',
          'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:text-ink active:text-ink',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out) group-open:rotate-90"
        />
        <Trans>Choose a profile</Trans>
      </summary>
      <div className="pt-3">
        <ProfilePicker
          settings={models}
          busy={command.pending}
          onChoose={(profileId) =>
            void command.run({ name: MODEL_COMMANDS.setProfile, payload: { profileId } })
          }
        />
      </div>
    </details>
  );
}

interface ChoicesProps {
  readonly accounts: AccountsState;
  readonly privacy: PrivacyOverview;
  readonly models: ModelSettings | undefined;
  readonly works: ThinkingWorks;
  readonly resume: ThinkingWay | undefined;
  onChoose(branch: OnboardingBranch): void;
}

/** The ways as rows, the profile list, and what got set up, announced. */
function ThinkingChoices({ accounts, privacy, models, works, resume, onChoose }: ChoicesProps) {
  const { t } = useLingui();
  const online = useOnline();
  const command = useCommand();
  const [open, setOpen] = useState<ThinkingWay | null>(resume ?? null);
  const [opened, setOpened] = useState(false);
  const [saferKey, setSaferKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (resume) setOpen(resume);
  }, [resume]);

  const choose = (way: ThinkingWay | null) => {
    setOpen(way);
    setOpened(true);
    if (way) onChoose({ thinking: way });
  };
  // A cloud way works: leave the Local only profile, which can't reach it.
  const cloudReady = (done: string) => {
    setAnnouncement(done);
    if (models?.activeProfileId === LOCAL_ONLY_PROFILE)
      void command.run({ name: MODEL_COMMANDS.setProfile, payload: { profileId: CLOUD_PROFILE } });
  };
  const ways = useThinkingWays({
    accounts,
    privacy,
    works,
    online,
    saferKey,
    cloudReady,
    announce: setAnnouncement,
    saferKeyFor: (provider) => {
      setSaferKey(SAFER_KEY[provider]);
      choose('api-key');
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <WayList label={t`Ways Taalcut can think`} ways={ways} open={open} onOpen={choose} animate={opened} />
      {models ? <ProfileChoice models={models} command={command} /> : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

export function ThinkingSetup({
  resume,
  onChoose,
}: {
  /** Where the person was last time (the saved branch). */
  resume?: ThinkingWay | undefined;
  onChoose: (branch: OnboardingBranch) => void;
}) {
  const { t } = useLingui();
  const data = useThinkingData();
  const works = data.accounts && data.privacy ? thinkingWorks(data.accounts, data.privacy) : null;
  useStepGate(
    works?.any ?? false,
    t({ id: 'onboarding.thinking.gate', message: 'Set up one of these ways to carry on.' }),
  );

  if (!data.accounts || !data.privacy || !works) {
    if (data.error) return <LoadError error={data.error} />;
    return <SkeletonLines lines={4} className="max-w-xl py-2" />;
  }
  return (
    <ThinkingChoices
      accounts={data.accounts}
      privacy={data.privacy}
      models={data.models}
      works={works}
      resume={resume}
      onChoose={onChoose}
    />
  );
}
