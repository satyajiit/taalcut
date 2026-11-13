// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What main passes to feedbackRouter: its own sections, collectors for the
 * jobs and agent processes, and the keychain values the scanner must see.
 * Jobs and the agent each collect their own sections. The agent collector
 * is the agent package's debugBundle.collect.
 * Secret values are kept for scrubbing and never logged.
 */
import { join } from 'node:path';
import { callRpc, type DebugCollectOptions, type DebugSection } from '@taalcut/core';
import { app, dialog } from 'electron';
import type { SecretStore } from '@taalcut/models';
import type { GpuInfo } from '../gpu/gpu-info';
import type { UtilityHost } from '../rpc/utility-host';
import { setCrashSecrets } from '../crash/reporting';
import { readPrivacyMirror, privacyMirrorPath, type PrivacyMirror } from '../crash/privacy-mirror';
import { buildDebugBundle, type MainDebugEnvironment } from './assemble';
import type { FeedbackDeps } from './feedback';
import { scanBundle } from './scan-bundle';

/** models' credential index. Not exported; the ids in it are not secret. */
const CREDENTIAL_INDEX = 'models.credential-index';

type Host = Pick<UtilityHost, 'client'>;

export interface DesktopFeedbackOptions {
  readonly host: Host;
  readonly userData: string;
  readonly homeDir: string;
  readonly version: string;
  readonly channel: string;
  readonly flavour: string;
  /** The OS's name for the bundle when the probe gives none (PlatformServices.label, 'macOS'). */
  readonly osLabel: string;
  readonly dsn: string;
  readonly gpu?: GpuInfo;
  readonly recovery: () => unknown;
}

export interface DesktopFeedback {
  readonly deps: FeedbackDeps;
  notePrivacy(mirror: PrivacyMirror): void;
  refreshSecrets(store: SecretStore): Promise<void>;
}

export function createDesktopFeedback(options: DesktopFeedbackOptions): DesktopFeedback {
  const secrets: string[] = [];
  let localOnly = readPrivacyMirror(privacyMirrorPath(options.userData)).localOnly;
  const homeDir = options.homeDir;
  return {
    notePrivacy(mirror) {
      localOnly = mirror.localOnly;
    },
    async refreshSecrets(store) {
      const next = await vaultSecretValues(store);
      secrets.splice(0, secrets.length, ...next);
      setCrashSecrets(secrets);
    },
    deps: {
      dsn: options.dsn,
      localOnly: () => localOnly,
      version: options.version,
      channel: options.channel,
      secrets,
      homeDir,
      build: (collect) =>
        buildDebugBundle(
          {
            environment: () => environmentOf(options),
            recovery: options.recovery,
            collectors: [collectFrom(options.host, 'jobs'), collectFrom(options.host, 'agent')],
            secrets,
            homeDir,
          },
          collect,
        ),
      scan: (sections) => scanBundle(sections, { secrets, homeDir }),
      choose: (defaultName) => chooseBundleFile(defaultName),
    },
  };
}

function collectFrom(host: Host, process: 'jobs' | 'agent') {
  return async (collect: DebugCollectOptions): Promise<readonly DebugSection[]> => {
    const result = await callRpc(host.client(process).debugBundle.collect(collect));
    return result.ok ? result.value : [];
  };
}

async function environmentOf(options: DesktopFeedbackOptions): Promise<MainDebugEnvironment> {
  const hardware = await callRpc(options.host.client('agent').system.hardware());
  const components = await callRpc(options.host.client('agent').system.components());
  let gpu: unknown = null;
  try {
    gpu = (await options.gpu?.read()) ?? null;
  } catch {
    // The environment section still goes out without a GPU report.
  }
  const info = hardware.ok ? hardware.value.info : undefined;
  return {
    version: options.version,
    channel: options.channel,
    // The OS by name as well as version: '24.04' alone reads as a macOS version (UX3-MAC).
    os: info ? (info.osName ?? `${options.osLabel} ${info.osVersion}`) : '',
    chip: info?.chip ?? '',
    memory: info?.memoryBytes ?? null,
    tier: hardware.ok ? hardware.value.tier : '',
    shortfalls: hardware.ok ? hardware.value.shortfalls : [],
    gpu,
    components: components.ok ? components.value : [],
    flavour: options.flavour,
  };
}

/** Raw credential strings (length filtered later). A locked vault leaves the list empty. */
async function vaultSecretValues(store: SecretStore): Promise<string[]> {
  const index = await store.get(CREDENTIAL_INDEX);
  if (!index.ok || index.value === undefined) return [];
  let ids: string[];
  try {
    const parsed: unknown = JSON.parse(index.value);
    ids = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
  const values: string[] = [];
  for (const id of ids) {
    const raw = await store.get(`models.credential.${id}`);
    if (!raw.ok || raw.value === undefined) continue;
    collectStrings(raw.value, values);
  }
  return values;
}

function collectStrings(raw: string, into: string[]): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (raw.length >= 8) into.push(raw);
    return;
  }
  walk(parsed, into);
}

function walk(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    if (value.length >= 8) into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walk(item, into);
  }
}

async function chooseBundleFile(defaultName: string): Promise<string | null> {
  const chosen = await dialog.showSaveDialog({
    defaultPath: join(app.getPath('downloads'), defaultName),
  });
  if (chosen.canceled || !chosen.filePath) return null;
  return chosen.filePath;
}
