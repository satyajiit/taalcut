// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { execFile } from 'node:child_process';
import { z } from 'zod';

export interface GhIssue {
  number: number;
  title: string;
}

export interface GhClient {
  listOpen(label: string): Promise<GhIssue[]>;
  create(input: { title: string; body: string; labels: string[] }): Promise<GhIssue>;
  comment(number: number, body: string): Promise<void>;
}

export interface ReportRegressionOptions {
  client: GhClient;
  fileIssues: boolean;
  runnerAllowlist: readonly string[];
  runnerId: string;
  metric: string;
  title: string;
  body: string;
}

export interface ReportRegressionResult {
  action: 'dry-run' | 'created' | 'commented' | 'skipped';
  command: string;
}

/** Runners allowed to open `perf-regression` issues. Anything else is skipped. */
export const DEFAULT_RUNNER_ALLOWLIST: readonly string[] = ['m1-8gb', 'recommended'];

const PERF_LABEL = 'perf-regression';

const ghIssueSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
  })
  .strict();

const ghIssueListSchema = z.array(ghIssueSchema);

function runGh(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', [...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim();
        const message = detail.length > 0 ? detail : error.message;
        reject(new Error(`gh ${args.join(' ')} failed: ${message}`, { cause: error }));
        return;
      }
      resolve(stdout);
    });
  });
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function createIssueCommand(title: string, body: string): string {
  return `gh issue create --label ${PERF_LABEL} --title ${quote(title)} --body ${quote(body)}`;
}

function commentCommand(number: number, body: string): string {
  return `gh issue comment ${number} --body ${quote(body)}`;
}

function parseIssueList(stdout: string): GhIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`gh issue list returned invalid JSON: ${message}`, { cause: error });
  }
  return ghIssueListSchema.parse(parsed);
}

function issueNumberFromUrl(stdout: string, title: string): GhIssue {
  const match = stdout.trim().match(/\/issues\/(\d+)\s*$/);
  const digits = match?.[1];
  if (digits === undefined) throw new Error(`gh issue create did not return an issue URL: ${stdout.trim()}`);
  return { number: Number(digits), title };
}

/** Shells out to `gh` with `execFile` (no shell). */
export function ghCommandClient(): GhClient {
  return {
    async listOpen(label: string): Promise<GhIssue[]> {
      const stdout = await runGh([
        'issue',
        'list',
        '--label',
        label,
        '--state',
        'open',
        '--json',
        'number,title',
        '--limit',
        '50',
      ]);
      return parseIssueList(stdout);
    },
    async create(input: { title: string; body: string; labels: string[] }): Promise<GhIssue> {
      const args = ['issue', 'create'];
      for (const label of input.labels) args.push('--label', label);
      args.push('--title', input.title, '--body', input.body);
      const stdout = await runGh(args);
      return issueNumberFromUrl(stdout, input.title);
    },
    async comment(number: number, body: string): Promise<void> {
      await runGh(['issue', 'comment', String(number), '--body', body]);
    },
  };
}

function matchesOpen(title: string, metric: string, runnerId: string): boolean {
  const prefix = `Perf: ${metric} on ${runnerId}`;
  if (!title.startsWith(prefix)) return false;
  const next = title.charAt(prefix.length);
  return next === '' || next === ' ' || next === '+';
}

function lowestNumber(issues: readonly GhIssue[]): GhIssue {
  let best = issues[0];
  if (best === undefined) throw new Error('no open issue to comment on');
  for (const issue of issues) {
    if (issue.number < best.number) best = issue;
  }
  return best;
}

/**
 * Dry-run unless `fileIssues` is set. Runners outside the allowlist never file, even then.
 * An open issue whose title starts with `Perf: <metric> on <runner>` is commented, not duplicated.
 */
export async function reportRegression(options: ReportRegressionOptions): Promise<ReportRegressionResult> {
  const { client, fileIssues, runnerAllowlist, runnerId, metric, title, body } = options;
  if (!runnerAllowlist.includes(runnerId)) {
    return {
      action: 'skipped',
      command: `skipped: runner ${runnerId} is not in the allowlist (${runnerAllowlist.join(', ')})`,
    };
  }
  const command = createIssueCommand(title, body);
  if (!fileIssues) return { action: 'dry-run', command };
  const open = await client.listOpen(PERF_LABEL);
  const matches = open.filter((issue) => matchesOpen(issue.title, metric, runnerId));
  if (matches.length > 0) {
    const existing = lowestNumber(matches);
    await client.comment(existing.number, body);
    return { action: 'commented', command: commentCommand(existing.number, body) };
  }
  await client.create({ title, body, labels: [PERF_LABEL] });
  return { action: 'created', command };
}
