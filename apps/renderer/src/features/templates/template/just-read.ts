// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The success moment on a template's overview (UX4 tpl): the first time you open a template Taalcut read from a reel
 * in the last day, Kaatu says it's read. It shows on that first visit only, kept on this computer like a dismissed
 * tip (a convenience: a cleared store shows it once more, never wrongly).
 */
import type { Template, TemplateId, TemplateSummary } from '@taalcut/core';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'taalcut.templates.just-read';
const DAY_MS = 86_400_000;
const KEEP = 50;

function seen(): TemplateId[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is TemplateId => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function remember(id: TemplateId): void {
  try {
    const ids = [id, ...seen().filter((each) => each !== id)].slice(0, KEEP);
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: the moment may show again on the next visit, which is harmless.
  }
}

/** True when this template was just read from a reel and hasn't been opened since. */
export function isJustRead(template: Template, summary: TemplateSummary, now: number): boolean {
  return (
    template.origin.kind === 'reference' &&
    now - summary.createdAt < DAY_MS &&
    !seen().includes(template.id)
  );
}

export function useJustRead(template: Template, summary: TemplateSummary, now = Date.now()) {
  const [shown, setShown] = useState(() => isJustRead(template, summary, now));
  // Shown once: the visit that shows it counts as seen.
  useEffect(() => {
    if (shown) remember(template.id);
  }, [shown, template.id]);
  const dismiss = useCallback(() => setShown(false), []);
  return { shown, dismiss };
}
