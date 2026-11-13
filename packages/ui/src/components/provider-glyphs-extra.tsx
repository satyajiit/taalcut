// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Additional SVGL brand glyphs for providers, model families, stock sources,
 * and external coding agents (Cursor, DeepSeek, Mistral, Meta, Instagram,
 * Black Forest Labs / Flux, Pexels).
 */

/** Cursor IDE / Agent logo (SVGL). */
export function CursorGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M11.999 2L3.34 7v10l8.659 5 8.66-5V7l-8.66-5zm6.794 13.923L12 19.846v-7.846L18.793 8v7.923zM11.999 10.385L5.206 6.462 12 2.538l6.793 3.924-6.794 3.923z" />
    </svg>
  );
}

/** DeepSeek logo (SVGL). */
export function DeepSeekGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M21.42 11.18c-.44-2.18-1.92-3.98-3.95-4.88-.32-.14-.68.08-.68.43v1.34c0 .38-.36.65-.73.54-1.36-.41-2.85-.39-4.21.08-2.34.81-4.01 2.94-4.23 5.41-.28 3.16 1.84 5.95 4.86 6.62 2.77.61 5.56-.69 6.84-3.18.21-.41.77-.47 1.07-.12l.82.96c.24.28.68.25.88-.06 1.24-1.92 1.75-4.32 1.33-6.64v-.5zm-8.92 6.07a3.25 3.25 0 1 1 0-6.5 3.25 3.25 0 0 1 0 6.5zM4.75 7.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5z" />
    </svg>
  );
}

/** Mistral AI logo (SVGL). */
export function MistralGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M3 3h3.6v3.6H3V3zm14.4 0H21v3.6h-3.6V3zM3 6.6h7.2v3.6H3V6.6zm10.8 0H21v3.6h-7.2V6.6zM3 10.2h18v3.6H3v-3.6zm0 3.6h3.6v3.6H3v-3.6zm7.2 0h3.6v3.6h-3.6v-3.6zm7.2 0H21v3.6h-3.6v-3.6zM3 17.4h7.2V21H3v-3.6zm10.8 0H21V21h-7.2v-3.6z" />
    </svg>
  );
}

/** Meta / Llama infinity mark (SVGL). */
export function MetaGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6.89 6.5C4.14 6.5 2 9.18 2 12.63c0 2.94 1.84 4.87 4.24 4.87 1.94 0 3.49-1.26 5.26-4.01l.74-1.16.72 1.13c1.77 2.78 3.32 4.04 5.28 4.04 2.4 0 4.26-1.93 4.26-4.87 0-3.45-2.14-6.13-4.89-6.13-2.06 0-3.69 1.32-5.11 3.52L12 10.8l-.5-.78C10.08 7.82 8.95 6.5 6.89 6.5zm-.05 2.2c1.14 0 2.09.84 3.29 2.71l.62.97-.64 1c-1.25 1.95-2.25 2.92-3.47 2.92-1.28 0-2.34-1.1-2.34-2.67 0-2.22 1.12-3.93 2.54-3.93zm10.32 0c1.42 0 2.54 1.71 2.54 3.93 0 1.57-1.06 2.67-2.34 2.67-1.22 0-2.22-.97-3.47-2.92l-.64-1 .62-.97c1.2-1.87 2.15-2.71 3.29-2.71z" />
    </svg>
  );
}

/** Instagram glyph (SVGL). */
export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

/** Black Forest Labs / Flux geometric mark (SVGL). */
export function FluxGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.3l6.5 3.6L12 11.5 5.5 7.9 12 4.3zm-7 5.5l6 3.3v6.6l-6-3.3V9.8zm8 9.9v-6.6l6-3.3v6.6l-6 3.3z" />
    </svg>
  );
}

/** Pexels stock mark (SVGL). */
export function PexelsGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M4 3h9.5a5.5 5.5 0 0 1 1.8 10.7V21H4V3zm3.5 3.5v11h4.3v-3.5h1.7a2 2 0 1 0 0-4H7.5v-3.5z" />
    </svg>
  );
}
