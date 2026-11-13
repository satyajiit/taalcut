// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One axe set-up for every spec (P3-R2, apps/renderer/SPEC.md "P3-R2: accessibility pass targets"): WCAG 2.0 – 2.2
 * A and AA rules, with two of axe's off-by-default rules turned on, `target-size` (2.5.8, 24 × 24 px) and
 * `label-content-name-mismatch` (2.5.3, a control's name contains the words it shows), fail at every impact.
 * axe's best-practice rules (landmarks, heading order) run too and are attached to the report, but don't fail: they
 * aren't WCAG success criteria. Only `canvas` is left out (the viewer around it is named and checked).
 *
 * Every scan's findings are appended as JSON lines to `$TAALCUT_A11Y_OUT/axe-<worker>.jsonl` when that folder is
 * set, so a run can be counted afterwards. `TAALCUT_A11Y_RECORD_ONLY=1` records without failing (an inventory run:
 * every scan of every test is reached).
 */
import AxeBuilder from '@axe-core/playwright';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TAGS = [...WCAG_TAGS, 'best-practice'];

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
export type AxeViolation = AxeResults['violations'][number];

/**
 * The configured builder, for a spec that needs to narrow it further (`include`, `exclude`). `options` goes first:
 * AxeBuilder's `options()` replaces the whole option object, so after `withTags` it would drop the tag filter.
 */
export function axeFor(page: Page): AxeBuilder {
  return new AxeBuilder({ page })
    .options({
      rules: { 'target-size': { enabled: true }, 'label-content-name-mismatch': { enabled: true } },
    })
    .withTags(TAGS)
    .exclude('canvas');
}

/** Waits until finite animations have settled: mid-fade colours would give contrast that never shows. */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
}

/** A WCAG 2.0 – 2.2 A or AA rule (as opposed to one of axe's best practices). */
const isWcag = (v: AxeViolation) => v.tags.some((tag) => WCAG_TAGS.includes(tag));

function record(label: string, url: string, violations: readonly AxeViolation[]): void {
  const dir = process.env.TAALCUT_A11Y_OUT;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const info = test.info();
  const line = {
    spec: info.titlePath.join(' › '),
    label,
    url,
    violations: violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? null,
      wcag: isWcag(v),
      help: v.help,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    })),
  };
  appendFileSync(join(dir, `axe-${info.workerIndex}.jsonl`), `${JSON.stringify(line)}\n`);
}

/** One scan of the page as it is now (after `settle`), recorded when TAALCUT_A11Y_OUT is set. */
export async function scan(
  page: Page,
  label: string,
  builder: AxeBuilder = axeFor(page),
): Promise<AxeResults> {
  await settle(page);
  const results = await builder.analyze();
  record(label, page.url(), results.violations);
  return results;
}

export function describeViolation(v: AxeViolation): string {
  const nodes = v.nodes.map(
    (n) => `    ${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`,
  );
  return `${v.impact} ${v.id}: ${v.help}\n${nodes.join('\n')}`;
}

/** The violations a scan fails on: every WCAG one, whatever its impact. */
export function gated(results: AxeResults): AxeViolation[] {
  return results.violations.filter(isWcag);
}

/** Axe on the page as it is now: fails on any WCAG violation, each listed with its elements. */
export async function expectAccessible(
  page: Page,
  testInfo: TestInfo,
  label: string,
  builder?: AxeBuilder,
): Promise<void> {
  const results = await scan(page, label, builder);
  const practices = results.violations.filter((v) => !isWcag(v));
  if (practices.length > 0)
    await testInfo.attach(`${label}: axe best practices (not failed on)`, {
      body: practices.map(describeViolation).join('\n'),
      contentType: 'text/plain',
    });
  if (process.env.TAALCUT_A11Y_RECORD_ONLY === '1') return;
  expect(gated(results).map(describeViolation), `${label}: axe violations`).toEqual([]);
}
