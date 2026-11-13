// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import {
  parseSwitches,
  refusalMessage,
  refusedSwitches,
  unsafeEnvironment,
  unsafeSwitches,
  type SwitchRisk,
} from '../src/main/security/switches';

const EXE = '/Applications/Taalcut.app/Contents/MacOS/Taalcut';
const names = (argv: string[]) => unsafeSwitches([EXE, ...argv]).map((s) => s.name);
const risks = (argv: string[]) => unsafeSwitches([EXE, ...argv]).map((s) => s.risk);

describe('parseSwitches', () => {
  it('reads --name, --name=value and -name up to a bare --, skipping the executable', () => {
    expect(
      parseSwitches([
        EXE,
        '--No-Sandbox',
        '-js-flags=--a=b',
        'file.mov',
        '--log-file=',
        '--',
        '--single-process',
      ]),
    ).toEqual([
      { name: 'no-sandbox', value: '' },
      { name: 'js-flags', value: '--a=b' },
      { name: 'log-file', value: '' },
    ]);
  });
});

describe('unsafeSwitches', () => {
  it.each<[string, SwitchRisk]>([
    ['--remote-debugging-port=0', 'debugger'],
    ['--remote-debugging-pipe', 'debugger'],
    ['--remote-debugging-address=0.0.0.0', 'debugger'],
    ['--remote-allow-origins=*', 'debugger'],
    ['--inspect', 'inspector'],
    ['--inspect-brk=9229', 'inspector'],
    ['--inspect-port=0', 'inspector'],
    ['--inspect-brk-node', 'inspector'],
    ['--js-flags=--allow-natives-syntax', 'v8'],
    ['--no-sandbox', 'sandbox'],
    ['--disable-gpu-sandbox', 'sandbox'],
    ['--no-zygote', 'sandbox'],
    ['--single-process', 'process'],
    ['--in-process-gpu', 'process'],
    ['--renderer-cmd-prefix=/bin/sh -c', 'launcher'],
    ['--gpu-launcher=/tmp/x', 'launcher'],
    ['--utility-cmd-prefix=/tmp/x', 'launcher'],
    ['--browser-subprocess-path=/tmp/x', 'launcher'],
    ['--disable-web-security', 'web-security'],
    ['--disable-site-isolation-trials', 'web-security'],
    ['--ignore-certificate-errors', 'web-security'],
    ['--enable-blink-features=X', 'web-security'],
    ['--enable-unsafe-swiftshader', 'web-security'],
    ['--enable-logging=file', 'logging'],
    ['--log-file=/tmp/taalcut.log', 'logging'],
    ['--log-net-log=/tmp/net.json', 'logging'],
    ['--use-mock-keychain', 'keychain'],
    ['--allow-insecure-localhost', 'web-security'],
    ['--unsafely-treat-insecure-origin-as-secure=http://example.com', 'web-security'],
    ['--trace-startup', 'logging'],
    ['--trace-startup-file=/tmp/t.json', 'logging'],
    ['--enable-tracing-output=/tmp/t.json', 'logging'],
    ['--ssl-key-log-file=/tmp/keys.log', 'tls-keys'],
    ['--disable-features=IsolateOrigins,site-per-process', 'security-feature'],
    ['--disable-features=Translate,SitePerProcess<Trial', 'security-feature'],
    ['--disable-features=*networkservicesandbox:p/v', 'security-feature'],
    ['--disable-features=V8CodeMemoryWriteProtection', 'security-feature'],
  ])('%s is %s', (arg, risk) => {
    expect(risks([arg])).toEqual([risk]);
  });

  it('leaves harmless switches alone', () => {
    expect(
      names([
        '--enable-logging',
        '--enable-logging=stderr',
        '--lang=hi',
        '--user-data-dir=/tmp/u',
        '--disable-gpu',
        '--proxy-server=http://proxy:8080',
        '--force-device-scale-factor=2',
        '--disable-features=Translate,MediaRouter',
        '--enable-features=Metal,IsolateOrigins',
        '-psn_0_12345',
        'project.taalcut',
      ]),
    ).toEqual([]);
  });

  it('refuses a security feature in any --disable-features, not only the first', () => {
    expect(names(['--disable-features=Translate', '--disable-features=StrictOriginIsolation'])).toEqual([
      'disable-features',
    ]);
  });

  it('reports each switch once, in order', () => {
    expect(names(['--no-sandbox', '--js-flags=a', '--no-sandbox', '--js-flags=b'])).toEqual([
      'no-sandbox',
      'js-flags',
    ]);
  });
});

describe('unsafeEnvironment', () => {
  it('refuses logging to a file through the environment, not logging to stderr', () => {
    const names = (env: Record<string, string>) => unsafeEnvironment(env).map((s) => `${s.source}:${s.name}`);
    expect(names({ ELECTRON_ENABLE_LOGGING: 'file', ELECTRON_LOG_FILE: '/tmp/x' })).toEqual([
      'env:ELECTRON_ENABLE_LOGGING',
      'env:ELECTRON_LOG_FILE',
    ]);
    expect(names({ ELECTRON_ENABLE_LOGGING: '1', ELECTRON_LOG_FILE: '' })).toEqual([]);
  });

  it('refuses a TLS key log, in test builds too', () => {
    const env = { SSLKEYLOGFILE: '/tmp/keys.log' };
    expect(unsafeEnvironment(env).map((s) => `${s.risk}:${s.name}`)).toEqual(['tls-keys:SSLKEYLOGFILE']);
    expect(refusedSwitches({ packaged: true, flavour: 'test', argv: [EXE], env })).toHaveLength(1);
  });

  it("refuses Taalcut's development and test overrides in release builds only", () => {
    const env = {
      TAALCUT_FFMPEG_DIR: '/tmp/ffmpeg',
      TAALCUT_HUB_INDEX_URL: 'https://hub.example/v0/index.json',
      TAALCUT_HUB_WORKER_URL: 'https://api.example/',
      TAALCUT_RENDERER_URL: 'http://localhost:5173',
      TAALCUT_TEST_MODEL_SERVERS: '{}',
      TAALCUT_TEST_RECORDED_MODELS: '/tmp/cassettes',
      TAALCUT_LOCALE: 'en-XA',
    };
    const refused = (flavour: 'release' | 'test') =>
      refusedSwitches({ packaged: true, flavour, argv: [EXE], env }).map((s) => `${s.risk}:${s.name}`);
    expect(refused('release')).toEqual([
      'override:TAALCUT_FFMPEG_DIR',
      'override:TAALCUT_HUB_INDEX_URL',
      'override:TAALCUT_HUB_WORKER_URL',
      'override:TAALCUT_RENDERER_URL',
      'override:TAALCUT_TEST_MODEL_SERVERS',
      'override:TAALCUT_TEST_RECORDED_MODELS',
    ]);
    expect(refused('test')).toEqual([]);
    expect(refusedSwitches({ packaged: false, flavour: 'release', argv: [EXE], env })).toEqual([]);
  });

  it('refuses a local components release in every packaged build, test builds too; a checkout takes it (UX3-IDX)', () => {
    const env = { TAALCUT_DEV_COMPONENTS: '/home/me/release' };
    for (const flavour of ['release', 'test'] as const) {
      const refused = refusedSwitches({ packaged: true, flavour, argv: [EXE], env });
      expect(refused.map((s) => `${s.risk}:${s.name}`)).toEqual([
        'unsigned-components:TAALCUT_DEV_COMPONENTS',
      ]);
      expect(refusalMessage(refused)).toContain(
        'TAALCUT_DEV_COMPONENTS (installs runtimes and models from a manifest no Taalcut key signed)',
      );
    }
    expect(refusedSwitches({ packaged: false, flavour: 'release', argv: [EXE], env })).toEqual([]);
  });

  it('refuses a packaged release whose launcher names a hub, either address alone (review M3)', () => {
    for (const name of ['TAALCUT_HUB_INDEX_URL', 'TAALCUT_HUB_WORKER_URL']) {
      const refused = refusedSwitches({
        packaged: true,
        flavour: 'release',
        argv: [EXE],
        env: { [name]: 'https://attacker.example/' },
      });
      expect(refused.map((s) => `${s.risk}:${s.name}`)).toEqual([`override:${name}`]);
      expect(refusalMessage(refused)).toContain(`${name} (points Taalcut at code, binaries or servers`);
    }
  });

  it('is part of what packaged builds refuse, and named as a variable', () => {
    const refused = refusedSwitches({
      packaged: true,
      flavour: 'test',
      argv: [EXE],
      env: { ELECTRON_LOG_FILE: '/x' },
    });
    expect(refusalMessage(refused)).toContain('refusing to start with ELECTRON_LOG_FILE (writes logs');
  });
});

describe('refusedSwitches', () => {
  const argv = [EXE, '--remote-debugging-port=0', '--use-mock-keychain', '--no-sandbox', '--inspect=0'];

  it('refuses everything unsafe in packaged release builds', () => {
    expect(refusedSwitches({ packaged: true, flavour: 'release', argv }).map((s) => s.name)).toEqual([
      'remote-debugging-port',
      'use-mock-keychain',
      'no-sandbox',
      'inspect',
    ]);
  });

  it('lets test builds use remote debugging and the mock keychain, nothing else', () => {
    expect(refusedSwitches({ packaged: true, flavour: 'test', argv }).map((s) => s.name)).toEqual([
      'no-sandbox',
      'inspect',
    ]);
  });

  it('refuses a forced crash and a crash DSN in a packaged release, and accepts both in a test build', () => {
    const argv = [EXE, '--taalcut-test-crash=main', '--taalcut-crash-dsn=http://127.0.0.1:9/1'];
    expect(refusedSwitches({ packaged: true, flavour: 'release', argv }).map((s) => s.name)).toEqual([
      'taalcut-test-crash',
      'taalcut-crash-dsn',
    ]);
    expect(refusedSwitches({ packaged: true, flavour: 'test', argv })).toEqual([]);
  });

  it('refuses nothing when unpackaged (development, Playwright for Electron)', () => {
    expect(refusedSwitches({ packaged: false, flavour: 'release', argv })).toEqual([]);
  });

  it('says what each refused switch does', () => {
    const message = refusalMessage(unsafeSwitches([EXE, '--no-sandbox', '--log-file=/tmp/x']));
    expect(message).toBe(
      'Taalcut: refusing to start with --no-sandbox (turns off a process sandbox), --log-file (writes logs ' +
        "to a file of its choosing). Release builds don't accept switches that weaken their security.",
    );
  });
});
