// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a network call is headed, from the arguments Node's APIs take (network-recorder.ts): a socket's
 * connect, an HTTP request, a datagram send, a URL. Pure functions; an argument shape they don't know
 * reads as 'localhost' only where Node itself defaults to it.
 */

export interface NetworkTarget {
  readonly host: string;
  readonly port: number | null;
}

type Bag = Readonly<Record<string, unknown>>;

const isBag = (value: unknown): value is Bag =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const portOf = (value: unknown): number | null => {
  const port = typeof value === 'string' ? (value.trim() === '' ? null : Number(value)) : value;
  return typeof port === 'number' && Number.isInteger(port) && port >= 0 ? port : null;
};

/** A host as compared with the allow list: lower case, without IPv6 brackets or a trailing dot. */
export function normaliseHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
}

/** True for 127.0.0.0/8, ::1 and their IPv4-mapped form, and 'localhost'. */
export function isLoopbackHost(host: string): boolean {
  const h = normaliseHost(host).replace(/^::ffff:/, '');
  return h === 'localhost' || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * net.Socket#connect's target, or undefined for a pipe or Unix socket (not a network connection).
 * net.connect() hands it its arguments already normalised into [[options, callback]].
 */
export function socketTarget(args: readonly unknown[]): NetworkTarget | undefined {
  const normalised: unknown = args[0];
  const first: unknown = Array.isArray(normalised) ? normalised[0] : normalised;
  if (typeof first === 'string' && portOf(first) === null) return undefined;
  if (isBag(first)) {
    if (typeof first.path === 'string') return undefined;
    return { host: typeof first.host === 'string' ? first.host : 'localhost', port: portOf(first.port) };
  }
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: portOf(first) };
}

/** tls.connect(options) or tls.connect(port[, host][, options]). */
export function tlsTarget(args: readonly unknown[]): NetworkTarget | undefined {
  const [first, second] = args;
  if (isBag(first)) {
    if (typeof first.path === 'string') return undefined;
    return { host: typeof first.host === 'string' ? first.host : 'localhost', port: portOf(first.port) };
  }
  return { host: typeof second === 'string' ? second : 'localhost', port: portOf(first) };
}

/** http(s).request(url | options[, options][, callback]): the URL's or the options' host and port. */
export function requestTarget(args: readonly unknown[], defaultPort: number): NetworkTarget | undefined {
  const [first, second] = args;
  if (typeof first === 'string' || first instanceof URL) {
    const target = urlTarget(first);
    const extra = isBag(second) ? second : undefined;
    return extra && typeof extra.hostname === 'string'
      ? { host: extra.hostname, port: portOf(extra.port) ?? target?.port ?? defaultPort }
      : target;
  }
  if (!isBag(first)) return { host: 'localhost', port: defaultPort };
  if (typeof first.socketPath === 'string') return undefined;
  const host =
    typeof first.hostname === 'string'
      ? first.hostname
      : typeof first.host === 'string'
        ? first.host
        : 'localhost';
  return { host: host.replace(/:\d+$/, ''), port: portOf(first.port) ?? defaultPort };
}

const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  'http:': 80,
  'https:': 443,
  'ws:': 80,
  'wss:': 443,
};

/** A URL's host and port (the scheme's default when it names none); undefined for a URL that doesn't parse. */
export function urlTarget(input: unknown): NetworkTarget | undefined {
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : isBag(input) && typeof input.url === 'string'
          ? input.url
          : undefined;
  if (href === undefined) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'file:') return undefined;
    return { host: url.hostname, port: portOf(url.port) ?? DEFAULT_PORTS[url.protocol] ?? null };
  } catch {
    return undefined;
  }
}

/**
 * dgram.Socket#send(msg[, offset, length], port[, address][, callback]): the port is the number after the
 * message (the third number when offset and length come first), the address the string after it. Absent: the
 * socket's connected peer (`peer`).
 */
export function datagramTarget(
  args: readonly unknown[],
  peer: () => NetworkTarget | undefined,
): NetworkTarget | undefined {
  const rest = args.slice(1);
  const numbers = rest.filter((arg) => typeof arg === 'number');
  if (numbers.length === 0) return peer();
  const port = portOf(numbers.length >= 3 ? numbers[2] : numbers[0]);
  const after = rest.indexOf(numbers.length >= 3 ? numbers[2] : numbers[0]);
  const address = rest.slice(after + 1).find((arg) => typeof arg === 'string');
  return { host: typeof address === 'string' ? address : 'localhost', port };
}
