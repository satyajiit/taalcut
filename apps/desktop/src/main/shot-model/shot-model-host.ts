// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's side of the shot-boundary model's process (IX2-S2). A utility process that may ask (the jobs process)
 * posts SHOT_MODEL_IPC.request on its parent port; main forks the model's utility process and hands one end of a
 * new channel to each, after which they talk directly. Main keeps no state about the model beyond which process
 * asked for it:
 * - when the process that asked exits (a crash, a kill -9, a quit), its model processes are stopped too, so none
 *   outlives the jobs process (round IX's whisper-server lesson); the model also ends on its own when its port
 *   closes;
 * - a new request stops that process's older model processes (it asks only when it has none it still uses).
 * The model process opens no video and holds no VideoToolbox session, so stopping it never touches the hardware
 * decoder. Electron is injected (fork, createChannel), so this is unit-tested with fakes.
 */
import {
  SHOT_MODEL_IPC,
  shotModelRequestSchema,
  type ShotModelConnect,
  type ShotModelPortMessage,
} from '../../shared/shot-model-ipc';

/** The part of Electron's UtilityProcess used for the model process. `Port` is MessagePortMain. */
export interface ShotModelChild<Port> {
  readonly pid: number | undefined;
  postMessage(message: unknown, transfer: Port[]): void;
  kill(): boolean;
  once(event: 'exit', listener: (code: number) => void): unknown;
}

/** The part of Electron's UtilityProcess used for a process that may ask for one. */
export interface ShotModelRequester<Port> {
  on(event: 'message', listener: (message: unknown) => void): unknown;
  once(event: 'exit', listener: (code: number) => void): unknown;
  postMessage(message: unknown, transfer?: Port[]): void;
}

export interface ShotModelHostDeps<Port> {
  /** utilityProcess.fork of out/utility/shot-model.mjs; throws when it can't. */
  readonly fork: () => ShotModelChild<Port>;
  /** new MessageChannelMain(): one end for the model, the other for the process that asked. */
  readonly createChannel: () => { readonly model: Port; readonly client: Port };
  /** What the model process needs to load ONNX Runtime. */
  readonly connect: Omit<ShotModelConnect, 'type'>;
  /** The utility processes that may ask: the jobs process. */
  readonly allowed: readonly string[];
  readonly log?: (message: string) => void;
}

export interface ShotModelHost<Port> {
  /** Called for every utility process main forks; serves the ones in `allowed`. */
  attach(name: string, child: ShotModelRequester<Port>): void;
}

export function shotModelHost<Port>(deps: ShotModelHostDeps<Port>): ShotModelHost<Port> {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const running = new Map<ShotModelRequester<Port>, Set<ShotModelChild<Port>>>();

  const stop = (requester: ShotModelRequester<Port>) => {
    for (const model of running.get(requester) ?? []) model.kill();
    running.delete(requester);
  };

  const serve = (requester: ShotModelRequester<Port>, request: number) => {
    stop(requester);
    const reply = (message: Omit<ShotModelPortMessage, 'type'>, transfer?: Port[]) =>
      requester.postMessage({ type: SHOT_MODEL_IPC.port, ...message }, transfer);
    let model: ShotModelChild<Port>;
    try {
      model = deps.fork();
    } catch (cause) {
      log(`[shot-model] could not start: ${String(cause)}`);
      reply({ request, error: `the shot model process could not start: ${String(cause)}` });
      return;
    }
    const models = running.get(requester) ?? new Set();
    running.set(requester, models.add(model));
    model.once('exit', () => models.delete(model));
    const { model: modelEnd, client } = deps.createChannel();
    model.postMessage({ type: SHOT_MODEL_IPC.connect, ...deps.connect } satisfies ShotModelConnect, [
      modelEnd,
    ]);
    reply({ request }, [client]);
  };

  return {
    attach(name, child) {
      if (!deps.allowed.includes(name)) return;
      child.on('message', (message) => {
        const asked = shotModelRequestSchema.safeParse(message);
        if (asked.success) serve(child, asked.data.request);
      });
      child.once('exit', () => stop(child));
    },
  };
}
