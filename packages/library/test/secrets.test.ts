// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-F5: secrets never reach the database or the logs. The write paths for
 * cloud calls, chat messages, tool runs and the run log get secret-bearing
 * input; the scan then reads every text column, the raw database and WAL
 * bytes, and the log file, and finds nothing.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap, type RunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  containsSecret,
  createCloudCallSink,
  createRepositories,
  findSecrets,
  openDatabase,
  redactSecrets,
  redactText,
  scanForSecrets,
} from '../src/index';
import { cloudCall } from './fixtures/records';
import { tempDir } from './helpers';

// Built at runtime so this file itself doesn't trip secret scanners.
const SECRETS = {
  openai: `sk-proj-${'A1b2C3d4'.repeat(5)}`,
  anthropic: `sk-ant-api03-${'xY9_zW8-'.repeat(6)}`,
  oauth: `sk-ant-ort01-${'Qq7'.repeat(12)}`,
  bearer: `Bearer ${'tok3n'.repeat(8)}`,
  jwt: `eyJ${'hbGciOiJIUzI1NiJ9'}.eyJ${'zdWIiOiIxMjM0NTY3ODkwIn0'}.${'s1gnatur3'.repeat(3)}`,
  googleRefresh: `1//0${'gRefresh_'.repeat(4)}`,
  formRefresh: `grant_type=refresh_token&refresh_token=${'r3fr3sh'.repeat(4)}`,
  github: `ghp_${'G1tHub'.repeat(6)}`,
};

const all = Object.values(SECRETS).join(' and ');

describe('redaction', () => {
  it('finds and redacts each kind of secret', () => {
    for (const [name, secret] of Object.entries(SECRETS)) {
      expect(findSecrets(`before ${secret} after`), name).not.toEqual([]);
      const redacted = redactText(`before ${secret} after`);
      expect(redacted, name).toMatch(/^before .*\[redacted:[a-z_]+\].* after$/);
      expect(findSecrets(redacted), name).toEqual([]);
    }
    expect(redactText(SECRETS.bearer)).toBe('Bearer [redacted:bearer]');
    expect(findSecrets(SECRETS.jwt)[0]).toMatchObject({ kind: 'jwt', index: 0 });
    expect(findSecrets(SECRETS.jwt)[0]!.preview).not.toContain(SECRETS.jwt.slice(10));
  });

  it('redacts secret-named keys whatever their value, and leaves clean values untouched', () => {
    const clean = { inputTokens: 5, text: 'hello', nested: [{ token: 3 }] };
    expect(redactSecrets(clean)).toBe(clean);
    expect(containsSecret(clean)).toBe(false);
    expect(redactSecrets({ apiKey: 'short', Authorization: 'Basic abc', password: '', list: [all] })).toEqual(
      {
        apiKey: '[redacted]',
        Authorization: '[redacted]',
        password: '',
        list: [redactText(all)],
      },
    );
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(redactSecrets(cyclic)).toBe(cyclic);
    const date = new Date();
    expect(redactSecrets({ date }).date).toBe(date);
  });
});

/** Review 2: shapes the one recognizer missed, built at runtime like SECRETS. */
const MORE = {
  huggingface: `hf_${'abcdefghij'.repeat(3)}012345`,
  xai: `xai-${'Xa1'.repeat(12)}`,
  pem: `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw\n${'AbCd'.repeat(10)}\n-----END PRIVATE KEY-----`,
  awsSecret: `aws_secret_access_key=${'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'}`,
  jsonApiKey: `{"api_key": "${'k3yV4lue'.repeat(3)}", "model": "x"}`,
  escapedJson: `{\\"apiKey\\":\\"${'k3yV4lue'.repeat(3)}\\"}`,
  envToken: `HF_TOKEN=${'t0k'.repeat(5)}`,
};

describe('redaction coverage (review 2)', () => {
  it('finds, redacts and refuses Hugging Face, xAI, PEM, AWS secret and JSON api_key secrets', () => {
    for (const [name, secret] of Object.entries(MORE)) {
      expect(containsSecret(`before ${secret} after`), name).toBe(true);
      const redacted = redactText(`before ${secret} after`);
      expect(redacted, name).toMatch(/\[redacted:[a-z_]+\]/);
      expect(findSecrets(redacted), name).toEqual([]);
    }
    expect(redactText(MORE.awsSecret)).toBe('aws_secret_access_key=[redacted:secret_field]');
    expect(JSON.parse(redactText(MORE.jsonApiKey))).toEqual({
      api_key: '[redacted:secret_field]',
      model: 'x',
    });
    expect(redactText(`key: ${MORE.pem}\nnext line`)).toBe('key: [redacted:private_key]\nnext line');
    // A public certificate and ordinary settings are not secrets.
    expect(containsSecret('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----')).toBe(false);
    expect(containsSecret('max_tokens=40960 and input_tokens: 123456789')).toBe(false);
  });

  it('treats a key containing a secret name as secret', () => {
    expect(redactSecrets({ aws_secret_access_key: 'x', OPENAI_API_KEY: 'y', GITHUB_TOKEN: 'z' })).toEqual({
      aws_secret_access_key: '[redacted]',
      OPENAI_API_KEY: '[redacted]',
      GITHUB_TOKEN: '[redacted]',
    });
    const references = { secretId: 'openai-main', apiKeyRef: 'keychain:openai', tokenizer: 'o200k' };
    expect(redactSecrets(references)).toBe(references);
  });

  it('walks Maps, Sets and Headers, and objects that are not plain', () => {
    const map = new Map<string, unknown>([
      ['note', `use ${SECRETS.openai}`],
      ['apiKey', 'short'],
    ]);
    const redactedMap = redactSecrets(map);
    expect(redactedMap).not.toBe(map);
    expect([...redactedMap]).toEqual([
      ['note', 'use [redacted:api_key]'],
      ['apiKey', '[redacted]'],
    ]);
    const headers = new Headers({ authorization: 'Basic dXNlcjpwYXNz', accept: 'text/plain' });
    expect(containsSecret(headers)).toBe(true);
    expect(redactSecrets(headers).get('authorization')).toBe('[redacted]');
    expect(redactSecrets(headers).get('accept')).toBe('text/plain');
    expect(containsSecret(new Set([SECRETS.github]))).toBe(true);
    class Request {
      constructor(
        readonly url: string,
        readonly apiKey: string,
      ) {}
    }
    expect(redactSecrets({ request: new Request('https://x', 'k') })).toEqual({
      request: { url: 'https://x', apiKey: '[redacted]' },
    });
    const clean = new Map([['a', 1]]);
    expect(redactSecrets(clean)).toBe(clean);
  });

  it('treats the user name and password in a URL as a secret, so settings refuse it', () => {
    const url = `http://ada:${'pa55w0rd'}@127.0.0.1:11434`;
    expect(containsSecret({ ollama: url })).toBe(true);
    expect(redactText(`server ${url}/v1`)).toBe(
      'server http://[redacted:url_credentials]@127.0.0.1:11434/v1',
    );
    expect(containsSecret(`https://${'t0ken'.repeat(4)}@git.example.com/repo`)).toBe(true);
    // Addresses without userinfo, and an @ in a path or an e-mail address, are not secrets.
    expect(
      containsSecret({
        ollama: 'http://127.0.0.1:11434',
        page: 'https://example.com/a@b',
        mail: 'ada@example.com',
      }),
    ).toBe(false);
    const db = unwrap(openDatabase({ path: join(tempDir(), 'library.db') }));
    const { settings } = createRepositories(db);
    expect(settings.set('accounts.localServers', { ollama: url })).toMatchObject({
      ok: false,
      error: { code: 'core.validation', params: { field: 'accounts.localServers' } },
    });
    expect(settings.all()).toEqual({});
    db.close();
  });

  it('scans a database and a log for every shape', () => {
    const dir = tempDir();
    const path = join(dir, 'library.db');
    const db = unwrap(openDatabase({ path }));
    const insert = db.driver.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 1)');
    Object.entries(MORE).forEach(([name, secret]) => insert.run(name, JSON.stringify(secret)));
    const log = join(dir, 'run.log');
    writeFileSync(log, Object.values(MORE).join('\n'));
    const report = scanForSecrets({ databasePath: path, logFiles: [log], rawBytes: false });
    Object.keys(MORE).forEach((name, i) => {
      const where = `table settings.value (rowid ${i + 1})`;
      expect(
        report.findings.some((f) => f.where === where),
        name,
      ).toBe(true);
    });
    expect(report.findings.filter((f) => f.where === `file ${log}`)).toHaveLength(Object.keys(MORE).length);
    db.close();
  });
});

describe('redaction (hardening: the MCP bearer, SB-26, and URL userinfo in raw bytes)', () => {
  // Built at runtime like SECRETS: Taalcut's MCP bearer, 'tcm_' and 43 base64url characters.
  const bearer = `tcm_${'Ab3_x-Yz9Q'.repeat(4)}Kp2`;

  it('finds and redacts the bearer on its own, cut short, and in JSON, and leaves look-alikes', () => {
    expect(bearer).toHaveLength(47);
    expect(redactText(`token ${bearer} ok`)).toBe('token [redacted:mcp_token] ok');
    expect(redactText(`cut ${bearer.slice(0, 30)}`)).toBe('cut [redacted:mcp_token]');
    expect(JSON.parse(redactText(JSON.stringify({ setup: `claude mcp add ${bearer}` })))).toEqual({
      setup: 'claude mcp add [redacted:mcp_token]',
    });
    expect(containsSecret({ note: bearer })).toBe(true);
    expect(containsSecret('tcm_short and atcm_' + 'x'.repeat(30))).toBe(false);
  });

  it('keeps URL userinfo to the characters a URL allows, so binary bytes after a quote are not one', () => {
    // A row's JSON then the next record's header in a WAL page: a timestamp byte read as '@' (seen 2026-10-15).
    expect(containsSecret('{"url":"https://api.example.com"}\u0001\u00a1@2')).toBe(false);
    expect(redactText('https://user:p%40ss@host.example/x')).toBe(
      'https://[redacted:url_credentials]@host.example/x',
    );
  });
});

describe('secrets scan', () => {
  it('finds no secret after the write paths get secret-bearing input', async () => {
    const dir = tempDir();
    const path = join(dir, 'library.db');
    const db = unwrap(openDatabase({ path }));
    const repos = createRepositories(db);

    const chat = unwrap(repos.conversations.create({ title: 'keys' }));
    unwrap(
      repos.conversations.appendMessage({ conversationId: chat.id, role: 'user', content: { text: all } }),
    );
    const run = unwrap(
      repos.toolRuns.start({
        toolName: 'web.fetch',
        toolVersion: '1',
        conversationId: chat.id,
        input: {
          url: 'https://api.example.com',
          headers: { authorization: SECRETS.bearer, 'x-api-key': 'k' },
        },
      }),
    );
    unwrap(
      repos.toolRuns.finish(run.id, {
        status: 'failed',
        output: { body: SECRETS.formRefresh },
        error: { code: 'tools.http_failed', detail: `401 for ${SECRETS.jwt}` },
      }),
    );
    unwrap(
      await createCloudCallSink(db).record(
        cloudCall({ outcome: 'error', errorCode: SECRETS.bearer, spanId: SECRETS.openai, runId: 'run-1' }),
      ),
    );
    unwrap(
      repos.runLog.append('run-1' as RunId, [{ at: 1, type: 'model.request', data: { prompt: all } }], {
        expectedSeq: 0,
      }),
    );
    const log = join(dir, 'main.log');
    writeFileSync(log, `[models] refreshing with ${redactText(SECRETS.oauth)}\n`);

    const report = scanForSecrets({ databasePath: path, logFiles: [log] });
    expect(report.findings).toEqual([]);
    expect(report.scanned.values).toBeGreaterThan(20);
    expect(report.scanned.files).toBe(3); // database, WAL, log
    db.close();
  });

  it('finds a secret planted in a table, in a log, and in deleted rows still in the file', () => {
    const dir = tempDir();
    const path = join(dir, 'library.db');
    const db = unwrap(openDatabase({ path }));
    db.driver
      .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('leak', JSON.stringify(SECRETS.anthropic), 1);
    const log = join(dir, 'main.log');
    writeFileSync(log, `auth: ${SECRETS.jwt}\n`);

    const report = scanForSecrets({ databasePath: path, logFiles: [log, join(dir, 'missing.log')] });
    const where = report.findings.map((f) => f.where);
    expect(where).toContain('table settings.value (rowid 1)');
    expect(where).toContain(`file ${log}`);
    expect(where.some((w) => w.startsWith('bytes '))).toBe(true);
    expect(report.findings.every((f) => !f.preview.includes(SECRETS.anthropic))).toBe(true);

    db.driver.prepare("DELETE FROM settings WHERE key = 'leak'").run();
    const after = scanForSecrets({ databasePath: path });
    expect(after.findings.some((f) => f.where.startsWith('table '))).toBe(false);
    expect(after.findings.some((f) => f.where.startsWith('bytes '))).toBe(true);
    expect(scanForSecrets({ databasePath: path, rawBytes: false }).findings).toEqual([]);
    db.close();
  });
});
