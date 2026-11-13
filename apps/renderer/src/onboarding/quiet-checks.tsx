// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: what the quiet checks need from you (UX4) · genre: atmospheric studio app · system: DESIGN.md "Mascot"
 *   (UX4 moments) + _orch/ux4/specs/design-onb.md
 * First run asks nothing technical before your footage: Taalcut picks its recommended model (the build's default
 *   profile) and downloads what this Mac needs by itself (quiet-start.ts). Only when one of those needs the person
 *   does it say so, on the last step, where it matters, as the step's Kaatu moment with the fix one press away:
 *   - nothing can think yet (no sign-in, key or Local only): Choose how opens the ways to connect under it, ChatGPT
 *     first (a fresh install always starts here: the default profile's agent is a cloud model);
 *   - the download stopped, or a part waits for its maker's terms (NVIDIA's on Linux): See why / Review opens the
 *     download's own section, with its reasons, Try again and the terms.
 *   A fix that worked stays open under the next moment, so what it did stays in view (Using ChatGPT plan, Key works,
 *   what Local only changes) until the step is left. Never a gate before the footage, and never a spec sheet: the
 *   Mac's details stay in Settings.
 * states: nothing needed (renders nothing) · thinking needed (tip, Choose how with the sign-in glyph) · download
 *   stopped (failure, alert, See why) · terms waiting (tip, Review) · open (the section under it, aria-expanded,
 *   collapsing smoothly; Hide) · fixed (the section stays, the moment moves on)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { OnboardingBranch } from '@taalcut/core';
import { Button, Collapse, KaatuMoment, useHostPlatform, VERB_ICONS } from '@taalcut/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useDownloads } from '../features/downloads/downloads-store';
import { useGpuSetup } from '../features/gpu-setup/gpu-setup-surface';
import { CUDA_RUNTIME, useAcceptTerms, useDeclined } from '../features/gpu-setup/nvidia-terms';
import { NvidiaTermsCard } from '../features/gpu-setup/nvidia-terms-card';
import { ThinkingSetup } from './setup/thinking/thinking-setup';
import { thinkingWorks, useThinkingData } from './setup/thinking/thinking-state';
import { ThisMacDownloads } from './setup/this-mac-downloads';

/** What a quiet check needs from the person, most pressing first; null when nothing does. */
export type QuietNeed = 'thinking' | 'download' | 'terms' | null;

/**
 * The checks as they stand: thinking first (a video can't start without it), then the download. A part whose terms
 * the person put off ("Not now", for the session: NVIDIA's card) asks nothing more.
 */
function useQuietNeed(declined: boolean): QuietNeed {
  const data = useThinkingData();
  const { downloads } = useDownloads();
  if (data.accounts && data.privacy && !thinkingWorks(data.accounts, data.privacy).any) return 'thinking';
  if (downloads?.state === 'failed' || downloads?.error) return 'download';
  const waiting = (downloads?.awaitingTerms ?? []).filter(
    (each) => !(declined && each.component.id === CUDA_RUNTIME),
  );
  return waiting.length > 0 ? 'terms' : null;
}

export interface QuietCheck {
  /** What the checks need now. */
  readonly need: QuietNeed;
  /** The fix to show: the need's, or the one that just worked while it is still open. */
  readonly fix: Exclude<QuietNeed, null> | null;
  readonly open: boolean;
  /** The fix section's id, for the toggle's aria-controls. */
  readonly region: string;
  toggle(): void;
  /** NVIDIA's "Not now": put off for the session, and the fix closes. */
  decline(): void;
}

/** The checks with their fix's open state; a resume (a way to think chosen last time) opens the fix again. */
export function useQuietCheck(resume: OnboardingBranch['thinking'] | undefined): QuietCheck {
  const [declined, putOff] = useDeclined(CUDA_RUNTIME);
  const need = useQuietNeed(declined);
  const region = useId();
  const [open, setOpen] = useState(false);
  const [kept, setKept] = useState<Exclude<QuietNeed, null> | null>(null);
  const resumed = useRef(false);
  useEffect(() => {
    if (need === 'thinking' && resume !== undefined && !resumed.current) {
      resumed.current = true;
      setOpen(true);
    }
  }, [need, resume]);
  useEffect(() => {
    if (need) setKept(need);
    else if (!open) setKept(null);
  }, [need, open]);
  return {
    need,
    fix: need ?? (open ? kept : null),
    open,
    region,
    toggle: () => setOpen((now) => !now),
    decline: () => {
      putOff();
      setOpen(false);
    },
  };
}

/** The step's moment for what the checks need, with the press that opens its fix. */
export function QuietCheckMoment({ check }: { check: QuietCheck & { need: Exclude<QuietNeed, null> } }) {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const { need, open } = check;
  const toggle = (label: string, icon?: typeof VERB_ICONS.signIn) => (
    <Button
      size="sm"
      variant="secondary"
      {...(icon && !open ? { icon } : {})}
      aria-expanded={open}
      aria-controls={check.region}
      data-action="quiet-check-open"
      onClick={check.toggle}
    >
      {open ? t`Hide` : label}
    </Button>
  );
  return (
    <div data-slot="quiet-check" data-need={need}>
      {need === 'thinking' ? (
        <KaatuMoment tone="tip" action={toggle(t`Choose how`, VERB_ICONS.signIn)}>
          <Trans>
            One thing first: Taalcut needs a model to write your video. Signing in with ChatGPT is the
            quickest.
          </Trans>
        </KaatuMoment>
      ) : need === 'download' ? (
        <KaatuMoment tone="failure" action={toggle(t`See why`)}>
          {mac ? (
            <Trans>The models for this Mac stopped downloading. Your video can still start.</Trans>
          ) : (
            <Trans>The models for this computer stopped downloading. Your video can still start.</Trans>
          )}
        </KaatuMoment>
      ) : (
        <KaatuMoment tone="tip" action={toggle(t`Review`)}>
          <Trans>One part waits for you to agree to its maker’s terms before it downloads.</Trans>
        </KaatuMoment>
      )}
    </div>
  );
}

/**
 * NVIDIA's terms as the fix: the card itself while the libraries wait on them (its Not now puts them off and closes
 * the fix), then the download's own section (the restart they need once installed).
 */
function TermsFix({ onDecline }: { onDecline: () => void }) {
  const { report, reading, held } = useGpuSetup();
  const accept = useAcceptTerms();
  if (!held) return <ThisMacDownloads />;
  if (reading) return null;
  const gpuName =
    report?.gpuSetup?.gpuName ?? report?.info.gpus?.find((gpu) => gpu.vendor === 'nvidia')?.name;
  return <NvidiaTermsCard component={held} gpuName={gpuName} accept={accept} onDecline={onDecline} />;
}

/** The fix itself, under the moment: the ways to connect, NVIDIA's terms, or the download's own section. */
export function QuietCheckFix({
  check,
  resume,
  onChoose,
}: {
  check: QuietCheck;
  resume: OnboardingBranch['thinking'] | undefined;
  onChoose: (branch: OnboardingBranch) => void;
}) {
  if (!check.fix) return null;
  return (
    <Collapse id={check.region} open={check.open}>
      <div data-slot="quiet-check-fix" data-need={check.fix} className="pt-1 pb-2">
        {check.fix === 'thinking' ? (
          <ThinkingSetup resume={resume} onChoose={onChoose} />
        ) : check.fix === 'terms' ? (
          <TermsFix onDecline={check.decline} />
        ) : (
          <ThisMacDownloads />
        )}
      </div>
    </Collapse>
  );
}
