// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A `project.rename` command that stages its write in the unit of work, as
 * real library commands do. `around` lets a test run code in the same
 * transaction just before and just after the rename (the crash test kills the
 * process there).
 */
import { defineCommand, idSchema, ok, type Result } from '@taalcut/core';
import { z } from 'zod';
import type { CommandUnitOfWork, Repositories } from '../../src/index';

export type Around = (name: string, phase: 'before' | 'after') => Result<unknown> | void;

export function renameCommand(repos: Repositories, commands: CommandUnitOfWork, around?: Around) {
  return defineCommand({
    name: 'project.rename',
    payload: z.object({ projectId: idSchema<'Project'>(), name: z.string().trim().min(1) }),
    sideEffect: 'write',
    handle: async ({ projectId, name }, context) => {
      const before = repos.projects.get(projectId);
      if (!before.ok) return before;
      const hook = (phase: 'before' | 'after') => () => around?.(name, phase) ?? ok(undefined);
      const writes: (() => Result<unknown>)[] = [() => repos.projects.rename(projectId, name)];
      if (around) writes.unshift(hook('before'));
      if (around) writes.push(hook('after'));
      for (const write of writes) {
        const staged = commands.stage(context, write);
        if (!staged.ok) return staged;
      }
      return ok({
        result: { projectId, name },
        inverse: { name: 'project.rename', payload: { projectId, name: before.value.name } },
      });
    },
  });
}
