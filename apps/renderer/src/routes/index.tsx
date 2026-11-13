// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, type OnboardingProgress, type TaalcutError } from '@taalcut/core';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useBackend } from '../backend/backend';
import { LaunchError } from '../onboarding/launch-error';
import { readLaunchHint, writeLaunchHint } from '../onboarding/launch-hint';
import { LaunchSkeleton } from '../onboarding/launch-skeleton';
import { resumeStep } from '../onboarding/steps';

// Chat is the main surface (PRD 9). Until first run is done (P2-X4) the app opens on it instead: the welcome on a
// fresh Mac, or the step you stopped at (a step of the order before UX4 resumes on Your videos).
export const Route = createFileRoute('/')({
  component: Home,
});

type Launch =
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly progress: OnboardingProgress }
  /** `retrying`: Try again is reading it again; the cause stays on screen meanwhile. */
  | { readonly kind: 'failed'; readonly error: TaalcutError; readonly retrying: boolean };

/** Where first run got to, read once; Try again reads it again (keeping the last cause on screen meanwhile). */
function useLaunch(): [Launch, () => void] {
  const backend = useBackend();
  const [launch, setLaunch] = useState<Launch>({ kind: 'reading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void callRpc(backend.onboarding.state(undefined, { signal: controller.signal })).then((result) => {
      if (controller.signal.aborted) return;
      setLaunch(
        result.ok
          ? { kind: 'read', progress: result.value }
          : { kind: 'failed', error: result.error, retrying: false },
      );
    });
    return () => controller.abort();
  }, [backend, round]);
  const retry = () => {
    setLaunch((now) => (now.kind === 'failed' ? { ...now, retrying: true } : now));
    setRound((n) => n + 1);
  };
  return [launch, retry];
}

function Home() {
  const [launch, retry] = useLaunch();
  const [hint] = useState(readLaunchHint);
  const done = launch.kind === 'read' && launch.progress.completedAt !== null;
  useEffect(() => {
    if (launch.kind === 'read') writeLaunchHint(done ? 'app' : 'setup');
  }, [launch.kind, done]);

  // A failed read never skips first run quietly: it says so, with Try again and the way into the app.
  if (launch.kind === 'failed')
    return <LaunchError error={launch.error} retrying={launch.retrying} onRetry={retry} />;
  if (launch.kind === 'reading') return <LaunchSkeleton hint={hint} />;
  const { progress } = launch;
  if (progress.completedAt !== null) return <Navigate to="/chat" replace />;
  if (progress.step === null) return <Navigate to="/onboarding" replace />;
  return <Navigate to="/onboarding/$step" params={{ step: resumeStep(progress.step) }} replace />;
}
