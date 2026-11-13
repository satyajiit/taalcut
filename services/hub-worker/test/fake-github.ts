// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { HIDDEN_FILE } from '../src/moderation/hidden-ids';
import {
  type GitHubPort,
  type GitHubResult,
  type IssueInput,
  type PullRequestInput,
  type PullState,
} from '../src/github/github-port';

export interface FakePull {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  labels: string[];
  state: PullState;
}

export interface FakeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  comments: string[];
}

/** The calls `failing` can break, with GitHub's answer (503). */
export type FakeCall = 'branch' | 'file' | 'pull' | 'close' | 'issue' | 'comment' | 'read';

const DOWN = { ok: false, failure: { kind: 'status', status: 503 } } as const;
const ok = <T>(value: T): GitHubResult<T> => ({ ok: true, value });
const missing = (what: string): GitHubResult<never> => ({ ok: false, failure: { kind: 'shape', what } });

/** An in-memory hub repository: branches of files, pull requests, issues. */
export class FakeGitHub implements GitHubPort {
  readonly branches = new Map<string, Map<string, string>>([['main', new Map()]]);
  readonly pulls: FakePull[] = [];
  readonly issues: FakeIssue[] = [];
  readonly messages: string[] = [];
  readonly closedComments: { number: number; comment: string }[] = [];
  readonly failing = new Set<FakeCall>();
  stateReads = 0;
  fileReads = 0;

  async createBranch(name: string, fromRef: string): Promise<GitHubResult<{ sha: string }>> {
    if (this.failing.has('branch')) return DOWN;
    const base = this.branches.get(fromRef);
    if (!base) return missing(`ref ${fromRef}`);
    if (!this.branches.has(name)) this.branches.set(name, new Map(base));
    return ok({ sha: 'a'.repeat(40) });
  }

  async putFile(path: string, content: string, branch: string, message: string): Promise<GitHubResult<null>> {
    if (this.failing.has('file')) return DOWN;
    const files = this.branches.get(branch);
    if (!files) return missing(`branch ${branch}`);
    files.set(path, content);
    this.messages.push(message);
    return ok(null);
  }

  async openPullRequest(input: PullRequestInput): Promise<GitHubResult<{ number: number }>> {
    if (this.failing.has('pull')) return DOWN;
    const number = this.pulls.length + 1;
    this.pulls.push({ number, ...input, labels: [...input.labels], state: 'open' });
    return ok({ number });
  }

  async pullRequestState(number: number): Promise<GitHubResult<PullState>> {
    this.stateReads += 1;
    const pull = this.pull(number);
    return pull ? ok(pull.state) : missing('pull');
  }

  async closePullRequest(number: number, comment: string): Promise<GitHubResult<null>> {
    if (this.failing.has('close')) return DOWN;
    const pull = this.pull(number);
    if (!pull) return missing('pull');
    pull.state = 'closed';
    this.closedComments.push({ number, comment });
    return ok(null);
  }

  async openIssue(input: IssueInput): Promise<GitHubResult<{ number: number }>> {
    if (this.failing.has('issue')) return DOWN;
    const number = this.issues.length + 1;
    this.issues.push({
      number,
      title: input.title,
      body: input.body,
      labels: [...input.labels],
      comments: [],
    });
    return ok({ number });
  }

  async commentIssue(number: number, body: string): Promise<GitHubResult<null>> {
    if (this.failing.has('comment')) return DOWN;
    const issue = this.issues.find((item) => item.number === number);
    if (!issue) return missing('issue');
    issue.comments.push(body);
    return ok(null);
  }

  async readFile(path: string, ref: string): Promise<GitHubResult<string | null>> {
    this.fileReads += 1;
    if (this.failing.has('read')) return DOWN;
    return ok(this.branches.get(ref)?.get(path) ?? null);
  }

  markMerged(number: number): void {
    const pull = this.pull(number);
    if (!pull) throw new Error(`no pull request ${number}`);
    pull.state = 'merged';
  }

  /** What moderate.yml commits to main when a maintainer adds or removes the `hidden` label. */
  setHidden(hubIds: readonly string[]): void {
    const rows = hubIds.map((hubId, index) => ({
      hubId,
      reason: 'report',
      issue: index + 1,
      at: 1_700_000_000_000,
    }));
    this.branches.get('main')?.set(HIDDEN_FILE, `${JSON.stringify(rows, null, 2)}\n`);
  }

  file(branch: string, path: string): string | undefined {
    return this.branches.get(branch)?.get(path);
  }

  private pull(number: number): FakePull | undefined {
    return this.pulls.find((item) => item.number === number);
  }
}
