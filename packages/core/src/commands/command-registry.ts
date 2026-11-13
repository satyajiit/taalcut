// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { NotFoundError } from '../basics/errors';
import { err, ok, type Result } from '../basics/result';
import type { CommandInfo } from './bus-types';
import type { AnyCommand } from './definition';

/** Registration and palette metadata, independent of execution and history. */
export function createCommandRegistry() {
  const commands = new Map<string, AnyCommand>();
  return {
    lookup(name: string): Result<AnyCommand> {
      const command = commands.get(name);
      return command ? ok(command) : err(NotFoundError({ entity: 'command', id: name }));
    },
    register(...definitions: AnyCommand[]) {
      for (const command of definitions) {
        if (commands.has(command.name)) throw new Error(`Command '${command.name}' is registered twice.`);
        commands.set(command.name, command);
      }
    },
    list(): CommandInfo[] {
      return [...commands.values()]
        .map(({ name, sideEffect, labelKey, shortcut, pcShortcut, internal, payload }) => ({
          name,
          sideEffect,
          labelKey,
          ...(shortcut !== undefined ? { shortcut } : {}),
          ...(pcShortcut !== undefined ? { pcShortcut } : {}),
          ...(internal ? { internal: true as const } : {}),
          ...(payload.safeParse({}).success ? {} : { needsPayload: true as const }),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}
