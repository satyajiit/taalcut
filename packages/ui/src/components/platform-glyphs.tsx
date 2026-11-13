// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Crisp SVGL-style brand and platform vector marks for video destinations,
 * NLE interchange targets, and HyperFrames motion graphics.
 */

/** YouTube Shorts play-bolt mark. */
export function YouTubeShortsGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.77 10.32l-1.2-.5L18 9.06a3.74 3.74 0 0 0-3.5-6.62l-6 2.49a3.74 3.74 0 0 0 .23 6.74l1.2.49L8.5 12.9a3.74 3.74 0 0 0 3.5 6.63l6-2.5a3.74 3.74 0 0 0-.23-6.71zM10 14.65v-5.3L15 12l-5 2.65z" />
    </svg>
  );
}

/** TikTok musical note mark. */
export function TikTokGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

/** DaVinci Resolve / OpenTimelineIO color-wheel rosette mark. */
export function DaVinciGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm-5.5 9.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm11 0a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z" />
    </svg>
  );
}

/** Adobe Premiere Pro badge mark. */
export function PremiereGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.5 4.5v9h2.2v-3h1.6c2.1 0 3.5-1.2 3.5-3s-1.4-3-3.5-3H6.5zm2.2 1.8h1.4c.9 0 1.5.5 1.5 1.2s-.6 1.2-1.5 1.2H8.7V9.3zm6.3 1.2v6h2.1v-3.4c0-1 .6-1.5 1.5-1.5h.4V9.5c-.9 0-1.6.4-2 1.1v-1.1H15z" />
    </svg>
  );
}

/** Apple Final Cut Pro clapperboard mark. */
export function FinalCutGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm1.5 2l2.5 3h2.5L8 6H5.5zm5 0l2.5 3h2.5L13 6h-2.5zm5 0l2.5 3H20V6h-4.5zM4 11v7h16v-7H4z" />
    </svg>
  );
}

/** HyperFrames motion-graphic diamond-frame mark. */
export function HyperFramesGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2L2 9.5 12 17l10-7.5L12 2zm0 3.1l6.4 4.4L12 13.9 5.6 9.5 12 5.1zM4.5 13.8L12 19.4l7.5-5.6 1.5 1.2-9 6.8-9-6.8 1.5-1.2z" />
    </svg>
  );
}
