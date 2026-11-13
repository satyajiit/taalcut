// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A report opens one moderation issue per template, labelled `report` and `hub:<hubId>` so a maintainer's
 * `hidden` label hides it (hub/.github/workflows/moderate.yml); later reports comment on that issue. The issue
 * carries the reason and the checked note, never the install key or its hash.
 */
import { type HubProblem, type HubReportReason, hubContentProblems } from '@taalcut/core/hub';

import { type GitHubPort, type GitHubResult } from '../github/github-port';
import { newUlid } from '../ids/ulid';
import { takeReport, type LimitRefusal } from '../limits/rate-limits';
import { firstIssue, insertReport } from '../store/d1-reports';
import { type D1Database } from '../store/d1';

export interface ReportDeps {
  db: D1Database;
  github: GitHubPort;
  now: () => number;
}

export interface ReportInput {
  hmac: string;
  hubId: string;
  reason: HubReportReason;
  note?: string | undefined;
}

export type ReportResult =
  | { status: 202; body: { issue: number } }
  | { status: 400; body: { code: 'hub.invalid'; problems: HubProblem[] } }
  | { status: 429; body: LimitRefusal }
  | { status: 503; body: { code: 'hub.github_unavailable' } };

/** Content rules on the note only. Schema failures belong to the hub document, not a free-text note. */
export function noteProblems(note: string): HubProblem[] {
  return hubContentProblems({ note })
    .filter((problem) => problem.rule !== 'schema' && problem.rule !== 'tooLarge')
    .map((problem) => ({ path: 'note', rule: problem.rule }));
}

export async function reportTemplate(deps: ReportDeps, input: ReportInput): Promise<ReportResult> {
  if (input.note) {
    const problems = noteProblems(input.note);
    if (problems.length > 0) return { status: 400, body: { code: 'hub.invalid', problems } };
  }
  const limit = await takeReport(deps.db, input.hmac, deps.now());
  if (!limit.ok) return { status: 429, body: limit };
  const issue = await fileReport(deps.github, await firstIssue(deps.db, input.hubId), input);
  if (!issue.ok) return { status: 503, body: { code: 'hub.github_unavailable' } };
  await insertReport(deps.db, {
    id: newUlid(deps.now()),
    hubId: input.hubId,
    reporter: input.hmac,
    reason: input.reason,
    issue: issue.value,
    at: deps.now(),
  });
  return { status: 202, body: { issue: issue.value } };
}

/** A comment on the template's issue, or its first issue. */
async function fileReport(
  github: GitHubPort,
  existing: number | null,
  input: ReportInput,
): Promise<GitHubResult<number>> {
  if (existing !== null) {
    const commented = await github.commentIssue(existing, commentBody(input));
    return commented.ok ? { ok: true, value: existing } : commented;
  }
  const opened = await github.openIssue({
    title: `Report ${input.reason} on ${input.hubId}`,
    body: issueBody(input),
    labels: ['report', `hub:${input.hubId}`],
  });
  return opened.ok ? { ok: true, value: opened.value.number } : opened;
}

function issueBody(input: ReportInput): string {
  const lines = [
    `Hub template: ${input.hubId}`,
    `Reason: ${input.reason}`,
    'The Worker checked the note against the hub content rules.',
    'Add the label `hidden` to hide the template; remove it to restore.',
  ];
  if (input.note) lines.push('', input.note);
  return lines.join('\n');
}

function commentBody(input: ReportInput): string {
  const lines = [`Another report: ${input.reason}.`];
  if (input.note) lines.push(input.note);
  return lines.join('\n');
}
