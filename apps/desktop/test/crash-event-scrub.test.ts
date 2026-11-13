// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X5: what a sent crash event may hold. Only listed fields survive, and every string in them loses the
 * home folder, paths, secrets, credential-named environment values and the user and machine names.
 */
import { describe, expect, it, vi } from 'vitest';
import { CONTEXT_FIELDS, scrubCrashEvent } from '../src/main/crash/scrub-event';
import { environmentSecrets, machineNames } from '../src/main/crash/scrub-sources';
import { NAME_MARK, replaceNames } from '../src/main/crash/text-shapes';

const HOME = '/Users/jdoe';
const OPTIONS = { homeDir: HOME, names: ['jdoe', 'Janes-MacBook-Pro'], secrets: ['tok_from_env_12345'] };

function scrubbed(event: Record<string, unknown>): Record<string, unknown> {
  return scrubCrashEvent(event, OPTIONS);
}

describe('a crash event as sent', () => {
  it('keeps only the listed top-level fields', () => {
    const out = scrubbed({
      event_id: 'abc',
      level: 'error',
      release: 'taalcut@1.0.0',
      environment: 'alpha',
      message: 'boom',
      user: { id: 'jdoe', ip_address: '10.0.0.2' },
      request: { url: 'https://example.test/?q=1' },
      extra: { argv: ['--flag'] },
      server_name: 'Janes-MacBook-Pro.local',
      modules: { electron: '44.7.2' },
      debug_meta: { images: [{ code_file: `${HOME}/x.dylib` }] },
      fingerprint: ['jdoe'],
    });
    expect(Object.keys(out).sort()).toEqual(['environment', 'event_id', 'level', 'message', 'release']);
  });

  it('keeps only the listed contexts and fields: no locale, time zone, screen or free memory', () => {
    const out = scrubbed({
      contexts: {
        os: {
          name: 'macOS',
          version: '26.7.1',
          build: '25G241',
          kernel_version: '25.6.0',
          raw: 'Darwin jdoe',
        },
        device: {
          arch: 'arm64',
          memory_size: 1,
          free_memory: 2,
          screen_resolution: '3024x1964',
          boot_time: 'x',
        },
        culture: { locale: 'en-US', timezone: 'Asia/Calcutta' },
        app: { app_name: 'Taalcut', app_version: '1.0.0', app_memory: 3, app_start_time: 'y' },
        cloud_resource: {},
        env: { HOME, PATH: '/usr/bin' },
      },
    });
    const contexts = out.contexts as Record<string, Record<string, unknown>>;
    expect(Object.keys(contexts).sort()).toEqual(['app', 'device', 'os']);
    for (const [key, fields] of Object.entries(contexts))
      expect(CONTEXT_FIELDS[key]).toEqual(expect.arrayContaining(Object.keys(fields)));
    expect(contexts.device).toEqual({ arch: 'arm64' });
  });

  it('replaces the home folder, paths, secrets and names in every kept string', () => {
    const out = scrubbed({
      message: `cannot open ${HOME}/Movies/beach.mov for jdoe on janes-macbook-pro: tok_from_env_12345`,
      tags: { process: 'renderer', host: 'Janes-MacBook-Pro' },
      contexts: {
        utility: { name: 'agent', code: 11, stderr: [`[agent] ${HOME}/Library/x.db locked by jdoe`] },
      },
      breadcrumbs: [
        { category: 'electron', message: `window.show ${HOME}/Movies`, data: { title: 'beach.mov' } },
        { category: 'electron.net', message: 'GET https://example.test', data: { url: 'x' } },
        { category: 'console', message: 'hello jdoe' },
      ],
    });
    const text = JSON.stringify(out);
    for (const leak of [
      HOME,
      'jdoe',
      'Janes-MacBook-Pro',
      'janes-macbook-pro',
      'tok_from_env_12345',
      'beach',
    ])
      expect(text).not.toContain(leak);
    expect(out.message).toBe(`cannot open <path:.mov> for ${NAME_MARK} on ${NAME_MARK}: [REDACTED]`);
    expect(out.breadcrumbs).toEqual([{ category: 'electron', message: 'window.show <path>' }]);
  });

  it('keeps app frames with their path, cuts other paths, and drops source lines and variables', () => {
    const out = scrubbed({
      exception: {
        values: [
          {
            type: 'Error',
            value: `ENOENT ${HOME}/a.txt`,
            mechanism: { type: 'generic', handled: false, data: { jdoe: 1 } },
            stacktrace: {
              frames: [
                {
                  function: 'open',
                  filename: '/Applications/Taalcut.app/Contents/Resources/app.asar/out/main/index.mjs',
                  module: 'index',
                  lineno: 1,
                  colno: 2,
                  context_line: 'const key = process.env.KEY',
                  vars: { key: 'secret' },
                },
                { function: 'read', filename: `${HOME}/Library/x.js`, module: 'x', lineno: 3 },
              ],
            },
          },
        ],
      },
    });
    const [value] = (out.exception as { values: Array<Record<string, unknown>> }).values;
    expect(value?.value).toBe('ENOENT <path:.txt>');
    expect(value?.mechanism).toEqual({ type: 'generic', handled: false });
    const frames = (value?.stacktrace as { frames: Array<Record<string, unknown>> }).frames;
    expect(frames[0]).toEqual({
      function: 'open',
      filename: '/Applications/Taalcut.app/Contents/Resources/app.asar/out/main/index.mjs',
      module: 'index',
      lineno: 1,
      colno: 2,
    });
    expect(frames[1]).toEqual({ function: 'read', filename: '<path:.js>', lineno: 3 });
  });

  it('replaces the home folder inside a file URL, as an app frame in ~/Applications has it', () => {
    const app = 'Applications/Taalcut.app/Contents/Resources/app.asar/out/main/index.mjs';
    const out = scrubbed({
      exception: {
        values: [{ value: 'x', stacktrace: { frames: [{ filename: `file://${HOME}/${app}` }] } }],
      },
    });
    expect(JSON.stringify(out)).toContain(`"filename":"file://~/${app}"`);
  });

  it("drops a log entry's params", () => {
    const out = scrubbed({ logentry: { message: 'failed %s', formatted: 'failed jdoe', params: [HOME] } });
    expect(out.logentry).toEqual({ message: 'failed %s', formatted: `failed ${NAME_MARK}` });
  });
});

describe('scrub sources', () => {
  it('takes the values of credential-named environment variables, at least 8 characters long', () => {
    const env = {
      GITHUB_TOKEN: 'ghp_aaaaaaaaaaaa',
      OPENAI_API_KEY: 'sk-bbbbbbbbbbbb',
      DB_PASSWORD: 'hunter2hunter2',
      SENTRY_DSN: 'https://k@sentry.example/1',
      SHORT_TOKEN: 'abc',
      HOME,
      LANG: 'en_US.UTF-8',
      MONKEY: 'banana-split',
    };
    expect(environmentSecrets(env).sort()).toEqual(
      ['ghp_aaaaaaaaaaaa', 'hunter2hunter2', 'https://k@sentry.example/1', 'sk-bbbbbbbbbbbb'].sort(),
    );
  });

  it('names the account and the host, with and without .local; a source that throws adds nothing', () => {
    expect(machineNames({ userName: () => 'jdoe', hostName: () => 'Janes-MacBook-Pro.local' })).toEqual([
      'jdoe',
      'Janes-MacBook-Pro.local',
      'Janes-MacBook-Pro',
    ]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const names = machineNames({
      userName: () => {
        throw new Error('no passwd entry');
      },
      hostName: () => 'studio',
    });
    expect(names).toEqual(['studio']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('replaces a name only where it stands alone, ignoring case, and skips names under 3 characters', () => {
    expect(replaceNames('jdoe, JDOE and jdoesmith', ['jdoe']).text).toBe('<name>, <name> and jdoesmith');
    expect(replaceNames('a cat', ['a']).text).toBe('a cat');
  });
});
