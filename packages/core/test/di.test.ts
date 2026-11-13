// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import {
  ClockToken,
  createContainer,
  createManualClock,
  createToken,
  systemClock,
  type Clock,
  type Container,
} from '@taalcut/core';

/* A tiny service graph written the way packages write services: plain factories, no container. */
interface Greeter {
  greet(name: string): string;
}
interface Welcome {
  welcome(name: string): string;
}
const GreeterToken = createToken<Greeter>('test.greeter');
const WelcomeToken = createToken<Welcome>('test.welcome');

const createGreeter = (): Greeter => ({ greet: (name) => `Hello ${name}` });
const createWelcome = ({ greeter, clock }: { greeter: Greeter; clock: Clock }): Welcome => ({
  welcome: (name) => `${greeter.greet(name)} at ${clock.now()}`,
});

/** The composition root: the only code that knows the container. */
function compose(container: Container): Container {
  return container
    .value(ClockToken, systemClock)
    .factory(GreeterToken, createGreeter)
    .factory(WelcomeToken, createWelcome, { deps: { greeter: GreeterToken, clock: ClockToken } });
}

describe('DI container', () => {
  it('resolves every service by token, once per container for singletons', () => {
    const container = compose(createContainer());
    const welcome = container.resolve(WelcomeToken);
    expect(welcome.welcome('Asha')).toMatch(/^Hello Asha at \d+$/);
    expect(container.resolve(WelcomeToken)).toBe(welcome);
    expect(container.has(GreeterToken)).toBe(true);
  });

  it('type-checks factories against the tokens they are given', () => {
    const container = createContainer();
    // @ts-expect-error createWelcome needs a clock, and deps doesn't provide one.
    container.factory(WelcomeToken, createWelcome, { deps: { greeter: GreeterToken } });
    // @ts-expect-error the greeter dep has the wrong type.
    container.factory(WelcomeToken, createWelcome, { deps: { greeter: ClockToken, clock: ClockToken } });
    // @ts-expect-error a Greeter is not a Welcome.
    container.factory(WelcomeToken, createGreeter);
    expect(container.has(WelcomeToken)).toBe(true);
  });

  it('swaps a fake implementation without touching callers', () => {
    const container = compose(createContainer());
    container.value(GreeterToken, { greet: (name) => `Fake hello ${name}` });
    container.value(ClockToken, createManualClock(42));
    expect(container.resolve(WelcomeToken).welcome('Asha')).toBe('Fake hello Asha at 42');
  });

  it('gives scoped services one instance per scope and lets a scope shadow values', () => {
    let made = 0;
    const SessionToken = createToken<{ n: number }>('test.session');
    const container = compose(createContainer()).factory(SessionToken, () => ({ n: ++made }), {
      lifetime: 'scoped',
    });
    const a = container.createScope();
    const b = container.createScope();
    expect(a.resolve(SessionToken)).toBe(a.resolve(SessionToken));
    expect(a.resolve(SessionToken)).not.toBe(b.resolve(SessionToken));
    expect(made).toBe(2);

    b.value(ClockToken, createManualClock(7));
    expect(b.resolve(ClockToken).now()).toBe(7);
    expect(container.resolve(ClockToken)).toBe(systemClock);
  });

  it('makes transient services fresh on every resolve', () => {
    const CounterToken = createToken<{ id: number }>('test.counter');
    let n = 0;
    const container = createContainer().factory(CounterToken, () => ({ id: ++n }), { lifetime: 'transient' });
    expect(container.resolve(CounterToken)).not.toBe(container.resolve(CounterToken));
  });

  it('disposes newest first, per scope, and reports every failure', async () => {
    const order: string[] = [];
    const DbToken = createToken<{ name: string }>('test.db');
    const RepoToken = createToken<{ name: string }>('test.repo');
    const RequestToken = createToken<{ name: string }>('test.request');
    const container = createContainer()
      .factory(DbToken, () => ({ name: 'db' }), { dispose: (s) => void order.push(s.name) })
      .factory(RepoToken, ({ db }) => ({ name: `repo(${db.name})` }), {
        deps: { db: DbToken },
        dispose: async (s) => void order.push(s.name),
      })
      .factory(RequestToken, () => ({ name: 'request' }), {
        lifetime: 'scoped',
        dispose: (s) => void order.push(s.name),
      });
    const scope = container.createScope();
    scope.resolve(RequestToken);
    container.resolve(RepoToken);

    await scope.dispose();
    expect(order).toEqual(['request']);
    await container.dispose();
    expect(order).toEqual(['request', 'repo(db)', 'db']);

    const FlakyToken = createToken<object>('test.flaky');
    const flaky = createContainer().factory(FlakyToken, () => ({}), {
      dispose: () => {
        throw new Error('stuck');
      },
    });
    flaky.resolve(FlakyToken);
    await expect(flaky.dispose()).rejects.toThrow(AggregateError);
  });

  it('treats wiring mistakes as bugs', () => {
    const MissingToken = createToken<object>('test.missing');
    const ScopedToken = createToken<object>('test.scoped');
    const SingletonToken = createToken<object>('test.singleton');
    const container = createContainer()
      .factory(ScopedToken, () => ({}), { lifetime: 'scoped' })
      .factory(SingletonToken, () => ({}), { deps: { scoped: ScopedToken } });
    expect(() => container.resolve(MissingToken)).toThrow(/test\.missing/);
    expect(() => container.createScope().resolve(SingletonToken)).toThrow(/shorter lifetime/);
    expect(() =>
      createContainer().factory(createToken<object>('test.transientDisposer'), () => ({}), {
        lifetime: 'transient',
        dispose: () => undefined,
      }),
    ).toThrow(/transient/);
    expect(() => createToken('NoNamespace')).toThrow(/Invalid token key/);
    expect(() => createToken('test.greeter')).toThrow(/defined twice/);
  });

  it('ships a manual clock for tests', () => {
    const clock = createManualClock(10);
    clock.advance(5);
    expect(clock.now()).toBe(15);
    clock.set(1);
    expect(clock.now()).toBe(1);
  });
});
