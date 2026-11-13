// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One template, read once by its frame (template-frame.tsx) and shared with its four pages (Overview, Slots, Pacing,
 * Details), so moving between them never reads it again or shows its bones twice. A page renders its part through
 * `TemplatePart`: the part's bones while the template is on its way, the last version dimmed while another arrives.
 */
import type { Template, TemplateSummary, TemplateVersionSummary } from '@taalcut/core';
import { Skeleton, StaleContent } from '@taalcut/ui';
import { createContext, useContext, type ReactNode } from 'react';
import { CAPTURE_TEMPLATE, CAPTURE_TEMPLATE_SUMMARY } from '../capture/template-fixtures';

export interface TemplateView {
  readonly summary: TemplateSummary;
  readonly template: Template;
  readonly versions: readonly TemplateVersionSummary[] | undefined;
  /** The version on screen is the head: it can be changed. */
  readonly latest: boolean;
  /** Another template or version is on its way: what shows is the last one. */
  readonly settling: boolean;
  /** Read another version (read-only), or undefined for the latest. */
  readonly onVersion: (version: number | undefined) => void;
}

const TemplateContext = createContext<TemplateView | null>(null);

export const TemplateProvider = TemplateContext.Provider;

/** The template on screen, or null while it is on its way. */
export function useTemplateView(): TemplateView | null {
  return useContext(TemplateContext);
}

const noop = () => undefined;

/** What the capture browser renders a part with: the fixture template, as its latest version. */
const CAPTURE_VIEW: TemplateView = {
  summary: CAPTURE_TEMPLATE_SUMMARY,
  template: CAPTURE_TEMPLATE,
  versions: [],
  latest: true,
  settling: false,
  onVersion: noop,
};

/** A page's part of the template: its bones while it loads (captured from `render` with the fixture), then it. */
export function TemplatePart({
  name,
  render,
}: {
  /** The skeleton's name (bones/registry.ts). */
  readonly name: string;
  readonly render: (view: TemplateView) => ReactNode;
}) {
  const view = useTemplateView();
  return (
    <Skeleton name={name} loading={!view} fixture={render(CAPTURE_VIEW)}>
      {view ? <StaleContent stale={view.settling}>{render(view)}</StaleContent> : null}
    </Skeleton>
  );
}
