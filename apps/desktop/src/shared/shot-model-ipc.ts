// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The raw messages that give the shot-boundary model a process of its own (IX2-S2, vision SPEC "Shot
 * boundaries"). Only main can fork a utility process, so the jobs process asks main for one, and main hands each
 * side one end of a new MessageChannelMain: from then on the jobs process and the model talk directly (vision's
 * model protocol). Like UTILITY_CONNECT, these go over the processes' parent ports, outside oRPC; each is checked
 * on arrival. No Electron here: main, the jobs process and the model process all import it.
 */
import { z } from 'zod';

export const SHOT_MODEL_IPC = {
  /** jobs → main (process.parentPort.postMessage): start a model process for me. */
  request: 'taalcut:shot-model-request',
  /** main → jobs (UtilityProcess.postMessage), with the port to the new model process, or why there is none. */
  port: 'taalcut:shot-model-port',
  /** main → the model process, with the port to the jobs process and where ONNX Runtime's binding is. */
  connect: 'taalcut:shot-model-connect',
} as const;

/** The model process's name in Activity Monitor and `app.getAppMetrics()`. */
export const SHOT_MODEL_SERVICE = 'Taalcut shot model';

const request = z.int().nonnegative();

export const shotModelRequestSchema = z.object({ type: z.literal(SHOT_MODEL_IPC.request), request });
export type ShotModelRequest = z.infer<typeof shotModelRequestSchema>;

export const shotModelPortSchema = z.object({
  type: z.literal(SHOT_MODEL_IPC.port),
  request,
  /** Set when main couldn't start the process; then no port comes with the message. */
  error: z.string().optional(),
});
export type ShotModelPortMessage = z.infer<typeof shotModelPortSchema>;

export const shotModelConnectSchema = z.object({
  type: z.literal(SHOT_MODEL_IPC.connect),
  /** `<userData>/components`: the onnxruntime component's binding (utility/component-natives.ts). */
  componentsRoot: z.string().min(1),
  packaged: z.boolean(),
});
export type ShotModelConnect = z.infer<typeof shotModelConnectSchema>;
