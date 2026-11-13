// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · state preview: the preview player's frame. Shown on /dev/kit; not used by any page.
 * Empty, loading and error, at a narrow width. Ready needs a preview session from the render process,
 * so it is checked in the app (apps/renderer/e2e/preview-player.e2e.ts), not here. */
import { useLingui } from '@lingui/react/macro';
import { useState, type ReactNode } from 'react';
import { PreviewFrame, type PreviewPhase } from './preview-frame';

/** A labelled sample, at a fixed width so the 9:16 frames line up. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="m-0 flex w-40 flex-col items-start gap-2">
      {children}
      <figcaption className="w-full text-xs text-ink-3">{label}</figcaption>
    </figure>
  );
}

export function PreviewPlayerPreview() {
  const { t } = useLingui();
  // Load again shows the skeleton, as it does in the app, so the button can be tried here.
  const [retried, setRetried] = useState<Record<string, boolean>>({});
  const retry = (key: string) => () => setRetried((done) => ({ ...done, [key]: true }));
  const samples: { key: string; label: string; phase: PreviewPhase; video?: boolean }[] = [
    { key: 'empty', label: t`Empty: nothing made yet`, phase: 'empty' },
    { key: 'loading', label: t`Loading: the first frame is on its way`, phase: 'loading' },
    { key: 'error', label: t`Error: the preview didn’t load`, phase: 'error' },
    { key: 'video', label: t`Error: a finished export didn’t load`, phase: 'error', video: true },
  ];
  return (
    <div data-slot="preview-player-preview" className="flex flex-wrap items-start gap-6">
      {samples.map(({ key, label, phase, video }) => (
        <Figure key={key} label={label}>
          <PreviewFrame
            className="w-full"
            phase={retried[key] ? 'loading' : phase}
            width={1080}
            height={1920}
            label={t`Video preview`}
            video={video}
            onRetry={retry(key)}
          />
        </Figure>
      ))}
    </div>
  );
}
