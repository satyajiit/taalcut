// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The flag guard: command-line switches a packaged release build refuses,
 * because each weakens the app in a way no fuse covers. Pure, so every rule
 * has a unit test; harden.ts applies it as the first thing main does.
 *
 * Test builds (TAALCUT_BUILD_FLAVOUR=test) accept remote debugging and the
 * mock keychain, which the packaged tests need. Unpackaged runs accept
 * everything. Anyone who can pass switches already runs as the user; the
 * point is that they can't borrow Taalcut's signature, keychain items or
 * privacy permissions (TCC) for code or behaviour Taalcut didn't ship.
 */
import { disabledSecurityFeatures } from './security-features';

export type SwitchRisk =
  | 'debugger'
  | 'inspector'
  | 'v8'
  | 'sandbox'
  | 'process'
  | 'launcher'
  | 'web-security'
  | 'logging'
  | 'keychain'
  | 'tls-keys'
  | 'security-feature'
  | 'override'
  | 'unsigned-components';

export const RISK_REASONS: Readonly<Record<SwitchRisk, string>> = {
  debugger: 'opens a debugger on the app',
  inspector: 'asks Node to open its inspector (the fuses ignore it anyway)',
  v8: 'changes how V8 compiles and runs code',
  sandbox: 'turns off a process sandbox',
  process: 'runs processes that are kept apart in one process',
  launcher: 'starts another program in place of a Taalcut process',
  'web-security': 'turns off a web security check',
  logging: 'writes logs to a file of its choosing',
  keychain: 'replaces the keychain with a fixed key',
  'tls-keys': 'writes the keys of its encrypted connections to a file',
  'security-feature': 'turns off a Chromium security feature',
  override: 'points Taalcut at code, binaries or servers from outside the app',
  'unsigned-components': 'installs runtimes and models from a manifest no Taalcut key signed',
};

interface Rule {
  readonly risk: SwitchRisk;
  /** Refuse only for these values; any value when absent. */
  readonly when?: (value: string) => boolean;
}

const EXACT: Readonly<Record<string, Rule>> = {
  'remote-allow-origins': { risk: 'debugger' },
  'js-flags': { risk: 'v8' },
  'no-sandbox': { risk: 'sandbox' },
  'disable-gpu-sandbox': { risk: 'sandbox' },
  'disable-setuid-sandbox': { risk: 'sandbox' },
  'disable-seccomp-filter-sandbox': { risk: 'sandbox' },
  'disable-namespace-sandbox': { risk: 'sandbox' },
  'no-zygote': { risk: 'sandbox' },
  'no-zygote-sandbox': { risk: 'sandbox' },
  'single-process': { risk: 'process' },
  'in-process-gpu': { risk: 'process' },
  'renderer-cmd-prefix': { risk: 'launcher' },
  'gpu-launcher': { risk: 'launcher' },
  'utility-cmd-prefix': { risk: 'launcher' },
  'browser-subprocess-path': { risk: 'launcher' },
  'disable-web-security': { risk: 'web-security' },
  'disable-site-isolation-trials': { risk: 'web-security' },
  'allow-running-insecure-content': { risk: 'web-security' },
  'allow-file-access-from-files': { risk: 'web-security' },
  'ignore-certificate-errors': { risk: 'web-security' },
  'ignore-certificate-errors-spki-list': { risk: 'web-security' },
  'enable-blink-features': { risk: 'web-security' },
  'enable-experimental-web-platform-features': { risk: 'web-security' },
  'enable-unsafe-swiftshader': { risk: 'web-security' },
  'allow-insecure-localhost': { risk: 'web-security' },
  'unsafely-treat-insecure-origin-as-secure': { risk: 'web-security' },
  // Turning off one buggy feature stays allowed for support; a security feature doesn't (SB-7).
  'disable-features': {
    risk: 'security-feature',
    when: (value) => disabledSecurityFeatures(value).length > 0,
  },
  // Plain --enable-logging (to stderr) stays allowed: it helps support and writes nowhere.
  'enable-logging': { risk: 'logging', when: (value) => value.toLowerCase() === 'file' },
  'log-file': { risk: 'logging' },
  'log-net-log': { risk: 'logging' },
  // Tracing writes URLs into a file in the working folder or one the caller names.
  'trace-startup': { risk: 'logging' },
  'trace-startup-file': { risk: 'logging' },
  'enable-tracing': { risk: 'logging' },
  'enable-tracing-output': { risk: 'logging' },
  // With --proxy-server (allowed), the key log would let a local proxy read a provider key in a request.
  'ssl-key-log-file': { risk: 'tls-keys' },
  'use-mock-keychain': { risk: 'keychain' },
  // Linux: safeStorage's key becomes a fixed one, as good as the clear (the vault refuses it too, platform/linux.ts).
  'password-store': { risk: 'keychain', when: (value) => value.toLowerCase() === 'basic' },
  // A test build's crash DSN (loopback). Release builds refuse it.
  'taalcut-crash-dsn': { risk: 'override' },
  // process.crash() in a named process. Test builds accept it; see refusedSwitches.
  'taalcut-test-crash': { risk: 'process' },
};

/** Packaged test builds accept this even though its risk is otherwise refused. */
const TEST_BUILD_SWITCHES = new Set(['taalcut-test-crash']);

/** Whole families: --remote-debugging-port/-pipe/-address/…, --inspect/-brk/-port/-brk-node/-wait/… */
const PREFIXES: readonly (readonly [string, Rule])[] = [
  ['remote-debugging-', { risk: 'debugger' }],
  ['inspect', { risk: 'inspector' }],
];

/**
 * Risks test builds accept: the packaged tests drive the renderer over CDP with a mock keychain,
 * and may point the app at test model servers, recorded models or an FFmpeg build.
 */
export const TEST_BUILD_ALLOWS: ReadonlySet<SwitchRisk> = new Set(['debugger', 'keychain', 'override']);

export interface ParsedSwitch {
  /** Lower case, without dashes or value. */
  readonly name: string;
  readonly value: string;
}

export interface RefusedSwitch extends ParsedSwitch {
  readonly risk: SwitchRisk;
  readonly reason: string;
  /** A command-line switch, or an environment variable Electron reads like one. */
  readonly source: 'argv' | 'env';
}

/**
 * The environment equivalents of --enable-logging=file, --log-file and --ssl-key-log-file.
 * ELECTRON_ENABLE_LOGGING=1 (stderr) stays allowed, like --enable-logging.
 * And Taalcut's own development and test overrides, which a release build's
 * code ignores; refusing them as well means none can slip back in. (TAALCUT_LOCALE
 * picks a language only, so it is simply ignored.)
 */
const ENV_RULES: Readonly<Record<string, Rule>> = {
  ELECTRON_ENABLE_LOGGING: { risk: 'logging', when: (value) => value.trim().toLowerCase() === 'file' },
  ELECTRON_LOG_FILE: { risk: 'logging' },
  SSLKEYLOGFILE: { risk: 'tls-keys' },
  TAALCUT_FFMPEG_DIR: { risk: 'override' },
  // A release bakes the hub's addresses (build-settings.ts); a Worker write sends the keychain install key there.
  TAALCUT_HUB_INDEX_URL: { risk: 'override' },
  TAALCUT_HUB_WORKER_URL: { risk: 'override' },
  TAALCUT_RENDERER_URL: { risk: 'override' },
  TAALCUT_TEST_MODEL_SERVERS: { risk: 'override' },
  TAALCUT_TEST_RECORDED_MODELS: { risk: 'override' },
  // A development run's local components release (utility/roots/dev-components.ts): an unsigned manifest, so no
  // packaged build takes it, test builds included.
  TAALCUT_DEV_COMPONENTS: { risk: 'unsigned-components' },
};

/**
 * Switches as Chromium reads them on macOS: `--name`, `--name=value` or
 * `-name`, up to a bare `--`. argv[0] is the executable.
 */
export function parseSwitches(argv: readonly string[]): ParsedSwitch[] {
  const switches: ParsedSwitch[] = [];
  for (const arg of argv.slice(1)) {
    if (arg === '--') break;
    const match = /^--?([^=]+)(?:=([\s\S]*))?$/.exec(arg);
    if (match?.[1]) switches.push({ name: match[1].toLowerCase(), value: match[2] ?? '' });
  }
  return switches;
}

function ruleFor(name: string): Rule | undefined {
  return EXACT[name] ?? PREFIXES.find(([prefix]) => name.startsWith(prefix))?.[1];
}

/** Every unsafe switch on the command line, once each. */
export function unsafeSwitches(argv: readonly string[]): RefusedSwitch[] {
  const found = new Map<string, RefusedSwitch>();
  for (const { name, value } of parseSwitches(argv)) {
    const rule = ruleFor(name);
    if (!rule || found.has(name) || (rule.when && !rule.when(value))) continue;
    found.set(name, { name, value, risk: rule.risk, reason: RISK_REASONS[rule.risk], source: 'argv' });
  }
  return [...found.values()];
}

/** Environment variables that Electron treats as unsafe switches, and Taalcut's own overrides. */
export function unsafeEnvironment(env: Readonly<Record<string, string | undefined>>): RefusedSwitch[] {
  return Object.entries(ENV_RULES).flatMap(([name, rule]) => {
    const value = env[name];
    if (!value || (rule.when && !rule.when(value))) return [];
    return [{ name, value, risk: rule.risk, reason: RISK_REASONS[rule.risk], source: 'env' as const }];
  });
}

export function refusedSwitches(options: {
  readonly packaged: boolean;
  readonly flavour: 'release' | 'test';
  readonly argv: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}): RefusedSwitch[] {
  if (!options.packaged) return [];
  const refused = [...unsafeSwitches(options.argv), ...unsafeEnvironment(options.env ?? {})];
  return options.flavour === 'test'
    ? refused.filter((s) => !TEST_BUILD_ALLOWS.has(s.risk) && !TEST_BUILD_SWITCHES.has(s.name))
    : refused;
}

export function refusalMessage(refused: readonly RefusedSwitch[]): string {
  const list = refused.map((s) => `${s.source === 'env' ? s.name : `--${s.name}`} (${s.reason})`).join(', ');
  return `Taalcut: refusing to start with ${list}. Release builds don't accept switches that weaken their security.`;
}
