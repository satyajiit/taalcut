// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The stand-in computer's side of "approve on computer" (UX3), for phone-page-support.ts's FakeMac:
// `POST /api/pair/ask` opens a request (a ticket and the two-digit match code) or refuses with one of the API's
// statuses, `POST /api/pair/wait` answers it the way the test planned (allowed, denied or lapsed after so many
// polls, or whenever the test calls answer()), and `POST /api/pair/cancel` withdraws it.

export type Verdict = 'allowed' | 'denied' | 'expired';
/** 202 opens a request; the rest are the API's refusals (401 token, 403 full, 404 not listening, 409 busy, 429). */
export type AskReply = 202 | 401 | 403 | 404 | 409 | 429;
export type ApprovalRequest = {
  ticket: string;
  code: string;
  polls: number;
  verdict: Verdict | null;
  after: number;
  told: boolean;
  withdrawn: boolean;
};
export type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

/** The match codes the requests show, in order: the first request shows 47, the second 81. */
export const MATCH_CODES = ['47', '81', '26', '93'] as const;
export const ALLOWED = { deviceId: 'phone-1', credential: 'credential-1' };

export class FakeApproval {
  /** How the next asks are answered, in order; once used up, every ask opens a request. */
  replies: AskReply[] = [];
  /** How the next requests end, in order: `verdict` after `after` pending polls. Once used up, they wait for answer(). */
  plans: Array<{ verdict: Verdict; after: number }> = [];
  /** What each ask carried. */
  asks: Array<{ token?: string; device?: { name?: string } }> = [];
  /** The tickets the page withdrew. */
  cancelled: string[] = [];
  requests: ApprovalRequest[] = [];
  polls = 0;

  /** The request waiting for an answer, if any. */
  open(): ApprovalRequest | undefined {
    return this.requests.find((request) => !request.told && !request.withdrawn);
  }

  /** A person answers the waiting request: its next poll hears it. */
  answer(verdict: Verdict): void {
    const open = this.open();
    if (open) Object.assign(open, { verdict, after: 0 });
  }

  /** The waiting request lapses without the page hearing it (a phone that stopped polling): its ticket is spent. */
  lapse(): void {
    const open = this.open();
    if (open) open.withdrawn = true;
  }

  handle(path: string, body: Record<string, unknown>): Reply {
    if (path === '/api/pair/ask') return this.ask(body);
    const request = this.requests.find((entry) => entry.ticket === body.ticket);
    if (path === '/api/pair/cancel') {
      if (!request) return { status: 404 };
      this.cancelled.push(request.ticket);
      request.withdrawn = true;
      return { status: 204 };
    }
    this.polls += 1;
    // An answered, withdrawn or unknown ticket: told once, then spent.
    if (!request || request.told || request.withdrawn)
      return { status: 404, body: { error: { code: 'pair.unknown' } } };
    request.polls += 1;
    if (!request.verdict || request.polls <= request.after)
      return { status: 200, body: { state: 'pending', expiresInMs: 50_000 } };
    request.told = true;
    const extra =
      request.verdict === 'allowed' ? { ...ALLOWED, limits: { chunkSize: 33_554_432, parallel: 1 } } : {};
    return { status: 200, body: { state: request.verdict, ...extra } };
  }

  private ask(body: Record<string, unknown>): Reply {
    this.asks.push(body as FakeApproval['asks'][number]);
    const reply = this.replies.shift() ?? 202;
    if (reply === 429)
      return { status: 429, body: { error: { code: 'pair.rate' } }, headers: { 'Retry-After': '1' } };
    if (reply === 409) return { status: 409, body: { reason: 'busy' } };
    if (reply !== 202) return { status: reply, body: { error: { code: 'pair.refused' } } };
    const index = this.requests.length;
    const plan = this.plans.shift();
    const request: ApprovalRequest = {
      ticket: `ticket${String(index + 1).padStart(37, '0')}`,
      code: MATCH_CODES[index % MATCH_CODES.length] ?? '47',
      polls: 0,
      verdict: plan?.verdict ?? null,
      after: plan?.after ?? 0,
      told: false,
      withdrawn: false,
    };
    this.requests.push(request);
    const answer = {
      ticket: request.ticket,
      matchCode: request.code,
      address: '192.168.1.20',
      expiresInMs: 60_000,
    };
    return { status: 202, body: { ...answer, pollMs: 300 } };
  }
}
