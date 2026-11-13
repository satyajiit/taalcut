// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the Worker asks of the hub repository. Every call answers a value: a GitHub failure (a status, no network,
 * a body of the wrong shape) is an outcome the routes turn into `hub.github_unavailable`, never an exception.
 */
export const PULL_STATES = ['open', 'merged', 'closed'] as const;
export type PullState = (typeof PULL_STATES)[number];

export type GitHubFailure =
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'network' }
  | { readonly kind: 'shape'; readonly what: string };

export type GitHubResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: GitHubFailure };

export interface PullRequestInput {
  title: string;
  body: string;
  head: string;
  base: string;
  labels: string[];
}

export interface IssueInput {
  title: string;
  body: string;
  labels: string[];
}

export interface GitHubPort {
  /** Creates the branch from `fromRef`, or reuses it when a retry finds it already there. */
  createBranch(name: string, fromRef: string): Promise<GitHubResult<{ sha: string }>>;
  /** One commit that creates or replaces the file on `branch`. */
  putFile(path: string, content: string, branch: string, message: string): Promise<GitHubResult<null>>;
  openPullRequest(input: PullRequestInput): Promise<GitHubResult<{ number: number }>>;
  pullRequestState(number: number): Promise<GitHubResult<PullState>>;
  closePullRequest(number: number, comment: string): Promise<GitHubResult<null>>;
  openIssue(input: IssueInput): Promise<GitHubResult<{ number: number }>>;
  commentIssue(number: number, body: string): Promise<GitHubResult<null>>;
  /** A file's text on `ref`; null when it doesn't exist. */
  readFile(path: string, ref: string): Promise<GitHubResult<string | null>>;
}
