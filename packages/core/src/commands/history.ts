// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Undo and redo stacks for one project, rebuilt from the audit log so they
 * survive a restart. Rules: a new audited command clears the redo stack; only
 * commands with an inverse go on the undo stack. EDT1: neighbours on a stack
 * that share a group are one step (`undoStep`, `redoStep`).
 */
import { newId, type CommandId } from '../basics/ids';
import type { AuditEntry } from './audit-log';
import type { CommandInvocation } from './definition';

export interface HistoryItem {
  readonly id: CommandId;
  readonly name: string;
  readonly payload: unknown;
  readonly inverse: CommandInvocation | null;
  /** The step it joined (DispatchOptions.group), or null on its own. */
  readonly group: string | null;
}

const item = (entry: AuditEntry): HistoryItem => ({
  id: entry.id,
  name: entry.name,
  payload: entry.payload,
  inverse: entry.inverse,
  group: entry.group ?? null,
});

/** The stack's top item and the items under it in its group, top first: what one undo or redo takes. */
function topStep(stack: readonly HistoryItem[]): HistoryItem[] {
  const top = stack.at(-1);
  if (!top) return [];
  if (top.group === null) return [top];
  const step: HistoryItem[] = [];
  for (let index = stack.length - 1; index >= 0 && stack[index]!.group === top.group; index -= 1)
    step.push(stack[index]!);
  return step;
}

export class ProjectHistory {
  token = newId<'Command'>();
  /** Last element is the next to undo. */
  private readonly undoStack: HistoryItem[] = [];
  /** Last element is the next to redo. */
  private readonly redoStack: HistoryItem[] = [];

  constructor(private readonly limit: number) {}

  /**
   * From entries oldest first. Undone entries after the newest live entry are
   * the redo stack; undone entries before it were cut off by a later command.
   */
  static fromEntries(entries: readonly AuditEntry[], limit: number): ProjectHistory {
    const history = new ProjectHistory(limit);
    let lastLive = 0;
    for (const entry of entries) if (!entry.undone) lastLive = Math.max(lastLive, entry.sequence);
    for (const entry of entries) {
      if (!entry.undone && entry.inverse) history.undoStack.push(item(entry));
    }
    const redoable = entries.filter((entry) => entry.undone && entry.sequence > lastLive);
    for (const entry of redoable.sort((a, b) => b.sequence - a.sequence)) history.redoStack.push(item(entry));
    history.trim();
    return history;
  }

  get nextUndo(): HistoryItem | undefined {
    return this.undoStack.at(-1);
  }

  get nextRedo(): HistoryItem | undefined {
    return this.redoStack.at(-1);
  }

  /** What the next undo reverses, newest first: the top command, with the rest of its group. */
  get undoStep(): readonly HistoryItem[] {
    return topStep(this.undoStack);
  }

  /** What the next redo runs again, oldest first. */
  get redoStep(): readonly HistoryItem[] {
    return topStep(this.redoStack);
  }

  executed(entry: AuditEntry): void {
    this.token = newId<'Command'>();
    this.redoStack.length = 0;
    if (entry.inverse) this.undoStack.push(item(entry));
    this.trim();
  }

  undone(): void {
    this.token = newId<'Command'>();
    const top = this.undoStack.pop();
    if (top) this.redoStack.push(top);
  }

  redone(inverse: CommandInvocation | null): void {
    this.token = newId<'Command'>();
    const top = this.redoStack.pop();
    if (top && inverse) this.undoStack.push({ ...top, inverse });
  }

  private trim(): void {
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
  }
}
