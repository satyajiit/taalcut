// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The export dialog's sections, in the order it shows them (apps/renderer SPEC, "Export dialog sections"). A new
 * export option is a new module here, never a branch in export-form.tsx.
 */
import { aiLabelSection } from './ai-label';
import { captionsSection } from './captions';
import { creditsSection } from './credits';
import { musicSection } from './music';
import { otherEditorsSection } from './other-editors';
import { reframeSection } from './reframe';
import type { ExportContext, ExportSection } from './types';
import { voiceSection } from './voice';
import { whereSection } from './where';

export const EXPORT_SECTIONS: readonly ExportSection[] = [
  whereSection,
  musicSection,
  voiceSection,
  captionsSection,
  reframeSection,
  aiLabelSection,
  creditsSection,
  otherEditorsSection,
];

/** The sections this export shows, decided once when the dialog opens so nothing jumps while you're in it. */
export function availableSections(context: ExportContext): readonly ExportSection[] {
  return EXPORT_SECTIONS.filter((section) => section.available(context));
}

export type { ExportChoices, ExportContext, ExportSection, ExportSectionId, SectionProps } from './types';
