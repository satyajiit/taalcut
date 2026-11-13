// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The decode service as the desktop's jobs process and the evals' indexing harness open it (IX2-V3, IX2-G3,
 * IX2-F14): the switch's setting (switch.ts), then the mac helper where one resolves.
 *
 * - The setting names no task (`off`): no service.
 * - No helper resolves (not a Mac, or a Mac without it): no service, said once per process through tell-once; every
 *   decode stays on FFmpeg, and no decode waits on a helper that isn't there.
 * - Otherwise the helper, taking the setting's tasks, started when the first of them asks, `decode` alone in its
 *   process and allowed to use `roots` (asked for at each decode: a new set of folders starts another helper, as
 *   render's helpers do). Its client never signals the helper (`holdsVideoSession: true`, the end policy): the
 *   helper invalidates its own VideoToolbox sessions and exits at the end of stdin.
 */
import { createJsonLineSidecar } from '../sidecar/json-line';
import type { SidecarResolver } from '../sidecar/resolver';
import { createMacHelperDecodeService } from './mac-helper';
import { decodeServiceChoice, decodeServiceWarning } from './switch';
import { tellOnce } from './tell-once';
import type { DecodeService, DecodeServiceTask } from './types';

export interface HelperDecodeServiceOptions {
  /** What the service takes (switch.ts `decodeServiceChoice`). */
  readonly tasks: readonly DecodeServiceTask[];
  /** The resolved helper binary. */
  readonly command: string;
  /** The folders the helper may read and write, symlinks resolved (the helper resolves them before it checks). */
  readonly roots: () => Promise<readonly string[]>;
  /** The helper exits after this long without a request. */
  readonly idleExitMs?: number;
  /** Test seam: starts the helper. Default: media's JSON-line client. */
  readonly open?: typeof createJsonLineSidecar;
}

/** The mac helper's decode service over `command`, one helper process per set of `roots`. */
export function helperDecodeService(options: HelperDecodeServiceOptions): DecodeService {
  const open = options.open ?? createJsonLineSidecar;
  const started = new Map<string, DecodeService>();
  const avoided = new Map<string, string>();

  const current = async (): Promise<DecodeService> => {
    const roots = [...new Set(await options.roots())];
    const key = roots.join('\n');
    const running = started.get(key);
    if (running) return running;
    const service = createMacHelperDecodeService(
      open({
        command: options.command,
        args: ['serve', '--services', 'decode', ...roots.flatMap((root) => ['--allow-root', root])],
        ...(options.idleExitMs !== undefined ? { idleExitMs: options.idleExitMs } : {}),
        holdsVideoSession: true,
      }),
    );
    started.set(key, service);
    return service;
  };

  return {
    id: 'mac-helper',
    tasks: options.tasks,
    pass: async (request, decode) => (await current()).pass(request, decode),
    frames: async (request, decode) => (await current()).frames(request, decode),
    avoid: (path, reason) => {
      avoided.set(path, reason);
    },
    avoided: (path) => avoided.get(path),
    async close() {
      await Promise.all([...started.values()].map((service) => service.close()));
    },
  };
}

export interface OpenDecodeServiceOptions extends Omit<HelperDecodeServiceOptions, 'tasks' | 'command'> {
  /** The switch's value: `TAALCUT_DECODE_SERVICE` from the process's environment. */
  readonly setting: string | undefined;
  /** Finds the helper: the platform's resolver, which finds none off a Mac. */
  readonly resolver: Pick<SidecarResolver, 'resolve'>;
  /** Where the switch's warning and the missing helper are said. Default: console.warn, once per process each. */
  readonly log?: (line: string) => void;
}

const ROUTE = 'decode service';
/** Once per process and reason: a switch value that named no setting, a helper that isn't there. */
const told = tellOnce(ROUTE);

/** The decode service the switch and this machine give: the helper's, or none (FFmpeg decodes everything). */
export async function openDecodeService(
  options: OpenDecodeServiceOptions,
): Promise<DecodeService | undefined> {
  const { log } = options;
  // A given log hears each line (one call says each reason at most once); console.warn once per process.
  const tell = log ? (_reason: string, line: string) => log(`[media] ${ROUTE}: ${line}`) : told;
  const choice = decodeServiceChoice(options.setting);
  const warning = decodeServiceWarning(choice);
  if (warning) tell('unknown_setting', warning);
  if (choice.tasks.length === 0) return undefined;
  const found = await options.resolver.resolve();
  if (!found.ok) {
    tell('no_helper', `no mac helper (${found.error.code}); FFmpeg decodes`);
    return undefined;
  }
  return helperDecodeService({
    tasks: choice.tasks,
    command: found.value.path,
    roots: options.roots,
    ...(options.idleExitMs !== undefined ? { idleExitMs: options.idleExitMs } : {}),
    ...(options.open ? { open: options.open } : {}),
  });
}
