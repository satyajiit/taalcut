// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-R6 (beta): an external agent's MCP bearer never leaves the Mac in a crash report or a debug bundle,
 * whether it is bare or behind `Bearer`. The vault index the known-secret pass reads holds only model
 * credentials, so these checks rest on the token's shape.
 */
import { MCP_TOKEN_PATTERN } from '@taalcut/core';
import { REDACTED } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { scrubCrashEvent, scrubStderrLine } from '../src/main/crash/scrub-event';
import { replaceMcpTokens } from '../src/main/crash/text-shapes';
import { redactText } from '../src/main/debug/redact-text';
import { scanBundle } from '../src/main/debug/scan-bundle';

const TOKEN = `tcm_${'Ab3_-xY9'.repeat(5)}Q2z`;

describe('MCP bearer tokens', () => {
  it('uses a token of the shape core mints', () => {
    expect(MCP_TOKEN_PATTERN.test(TOKEN)).toBe(true);
  });

  it('are replaced in crash text, bare or behind Bearer, and cut-short forms too', () => {
    expect(replaceMcpTokens(`key ${TOKEN} end`)).toEqual({ text: `key ${REDACTED} end`, count: 1 });
    expect(scrubStderrLine(`[mcp] Authorization: Bearer ${TOKEN}`)).not.toContain('tcm_');
    expect(scrubStderrLine(`copied ${TOKEN.slice(0, 30)}`)).not.toContain(TOKEN.slice(0, 30));
    const event = scrubCrashEvent({
      message: `setup text had ${TOKEN}`,
      extra: { config: `TOKEN=${TOKEN}` },
    });
    expect(JSON.stringify(event)).not.toContain('tcm_');
  });

  it('are redacted from text main writes into a debug bundle', () => {
    const { text, redactions } = redactText(`env TAALCUT_MCP_TOKEN=${TOKEN}`, {
      secrets: [],
      homeDir: '/Users/x',
    });
    expect(text).not.toContain('tcm_');
    expect(redactions.secrets).toBeGreaterThanOrEqual(1);
  });

  it('make the bundle scan refuse a section that still holds one', () => {
    const result = scanBundle(
      [{ section: 'logs', path: 'agent/logs.txt', mediaType: 'text/plain', text: TOKEN }],
      {
        secrets: [],
        homeDir: '/Users/x',
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.params).toEqual({ section: 'logs', rule: 'api_key' });
  });

  it('leave ordinary words that start with tcm alone', () => {
    expect(replaceMcpTokens('tcm_short and tcmx').count).toBe(0);
  });
});
