// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A DI token names one service and carries its type, so registering and
 * resolving by token is type-checked. See packages/core/SPEC.md, "Dependency
 * injection".
 *
 *   export interface Clock { now(): number }
 *   export const ClockToken = createToken<Clock>('core.clock');
 */

declare const tokenType: unique symbol;

export interface Token<T> {
  /** Unique name: '<package>.<camelCase>', e.g. 'library.projectRepository'. */
  readonly key: string;
  /** Type-only marker; never set at runtime. */
  readonly [tokenType]?: T;
}

/** The service type a token stands for. */
export type TokenType<K> = K extends Token<infer T> ? T : never;

const KEY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const keys = new Set<string>();

/** Declares a token once, next to the interface it stands for. A second token with the same key throws. */
export function createToken<T>(key: string): Token<T> {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid token key '${key}': use '<package>.<camelCase>'.`);
  if (keys.has(key)) throw new Error(`Token '${key}' is defined twice.`);
  keys.add(key);
  return Object.freeze({ key });
}
