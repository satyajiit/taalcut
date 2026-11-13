// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A small typed layer over awilix. Services stay plain factories,
 * `createX(deps)`, and never see the container; the composition root (main and
 * each utility process) registers them by token. Tests swap a fake by
 * registering another value for the same token.
 */
import {
  asValue,
  createContainer as createAwilixContainer,
  type AwilixContainer,
  type Resolver,
} from 'awilix';
import type { Token, TokenType } from './token';

/**
 * singleton: one per root container. scoped: one per scope. transient: new on every resolve.
 * A service may depend only on services that live at least as long (values always qualify).
 */
export type Lifetime = 'singleton' | 'scoped' | 'transient';

/** The tokens a factory needs, by the name its deps object uses. */
export type DepTokens = Readonly<Record<string, Token<unknown>>>;

/** What a factory receives for `DepTokens`. */
export type ResolvedDeps<D extends DepTokens> = { readonly [K in keyof D]: TokenType<D[K]> };

export interface FactoryOptions<T, D extends DepTokens> {
  readonly deps?: D;
  /** Default 'singleton'. */
  readonly lifetime?: Lifetime;
  /** Releases what the instance holds. Runs on dispose(), newest first. Not allowed for transient services. */
  readonly dispose?: (instance: T) => void | Promise<void>;
}

export interface Container {
  /** Registers a ready-made value (config, a fake in tests). Replaces any earlier registration. */
  value<T>(token: Token<T>, value: T): Container;
  /**
   * Registers a factory. Its deps are resolved by token from the container doing
   * the resolving. The factory's parameter must accept what `deps` provides, so a
   * missing or mistyped dependency is a type error.
   */
  factory<T, D extends DepTokens = Record<never, never>>(
    token: Token<T>,
    factory: (deps: NoInfer<ResolvedDeps<D>>) => T,
    options?: FactoryOptions<T, D>,
  ): Container;
  /** Resolves a service. A missing registration or a cycle throws: that's a wiring bug. */
  resolve<T>(token: Token<T>): T;
  has(token: Token<unknown>): boolean;
  /** A child container: scoped services get one instance per scope; values registered here shadow the parent. */
  createScope(): Container;
  /** Disposes this container's singleton or scoped instances, newest first. Child scopes dispose themselves. */
  dispose(): Promise<void>;
}

const LIFETIMES = { singleton: 'SINGLETON', scoped: 'SCOPED', transient: 'TRANSIENT' } as const;

type Disposer = () => void | Promise<void>;

/** Instances to dispose, per awilix container (root for singletons, the scope for scoped ones). */
type DisposalStacks = WeakMap<AwilixContainer, Disposer[]>;

export function createContainer(): Container {
  // Strict mode makes awilix reject a singleton that depends on a scoped service.
  return wrap(createAwilixContainer({ injectionMode: 'PROXY', strict: true }), new WeakMap());
}

/** An awilix resolver that builds the deps object from tokens and remembers who owns the instance. */
function factoryResolver<T, D extends DepTokens>(
  token: Token<T>,
  factory: (deps: ResolvedDeps<D>) => T,
  options: FactoryOptions<T, D>,
  stacks: DisposalStacks,
): Resolver<T> {
  const lifetime = options.lifetime ?? 'singleton';
  const { dispose } = options;
  const deps: DepTokens = options.deps ?? {};
  if (dispose && lifetime === 'transient') {
    throw new Error(`Token '${token.key}': a transient service can't have a disposer; nothing owns it.`);
  }
  return {
    lifetime: LIFETIMES[lifetime],
    // awilix passes the container that will cache the instance: the root for
    // singletons (strict mode), the scope for scoped services.
    resolve: <U extends object>(owner: AwilixContainer<U>): T => {
      const resolved: Record<string, unknown> = {};
      for (const [name, dep] of Object.entries(deps)) resolved[name] = owner.resolve(dep.key);
      const instance = factory(resolved as ResolvedDeps<D>);
      if (dispose) {
        const stack = stacks.get(owner) ?? [];
        stack.push(() => dispose(instance));
        stacks.set(owner, stack);
      }
      return instance;
    },
  };
}

function wrap(inner: AwilixContainer, stacks: DisposalStacks): Container {
  const container: Container = {
    value(token, value) {
      inner.register(token.key, asValue(value));
      return container;
    },

    factory(token, factory, options = {}) {
      inner.register(token.key, factoryResolver(token, factory, options, stacks));
      return container;
    },

    resolve<T>(token: Token<T>): T {
      return inner.resolve<T>(token.key);
    },

    has(token) {
      return inner.hasRegistration(token.key);
    },

    createScope() {
      return wrap(inner.createScope(), stacks);
    },

    async dispose() {
      const stack = stacks.get(inner) ?? [];
      stacks.delete(inner);
      const failures: unknown[] = [];
      for (const disposer of stack.reverse()) {
        try {
          await disposer();
        } catch (cause) {
          failures.push(cause);
        }
      }
      await inner.dispose();
      if (failures.length > 0) throw new AggregateError(failures, 'Some services failed to dispose.');
    },
  };
  return container;
}
