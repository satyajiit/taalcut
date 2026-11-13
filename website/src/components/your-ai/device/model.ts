// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What each computer runs, as data, for the memory meter (On your computer). Each computer carries only the ON_DEVICE
 * facts that name it, in their words: the 4B's floor of 16 GB is the same on a Mac and on Ubuntu, and Ubuntu adds the
 * graphics card. Pure, so test/unit/ai-map.test.ts can hold every big word to a fact.
 */
import { AI_DEVICES } from '#content/ai-map';
import { ON_DEVICE } from '#content/providers';
import type { Fact } from '#content/schema';

export type DeviceId = (typeof AI_DEVICES)[number]['id'];

const fact = (i: number): Fact => ON_DEVICE.facts[i]!;
/** ON_DEVICE.facts in order: always here, speech, the agent (4B), on Ubuntu, high-end Macs (9B), 8 GB Macs. */
export const ALWAYS = fact(0);
export const SPEECH = fact(1);
const AGENT_4B = fact(2);
const ON_UBUNTU = fact(3);
const AGENT_9B = fact(4);
const SMALL = fact(5);
/** The labels the readout keys on: "The agent" (the 4B's fact, every computer with 16 GB) and "On Ubuntu". */
export const AGENT_LABEL = AGENT_4B[0];
export const UBUNTU_LABEL = ON_UBUNTU[0];

/** Gigabytes a meter segment stands for, and the meter's length (32 GB). */
export const GB_PER_SEGMENT = 4;
export const SEGMENTS = 8;

export interface DeviceRun {
  readonly id: DeviceId;
  readonly name: string;
  readonly brand: 'apple' | 'ubuntu';
  /** Memory in GB: how far the meter fills. */
  readonly memory: number;
  /** The fact allows more ("16 GB of memory or more"): the rest of the meter is drawn dashed. */
  readonly orMore: boolean;
  /** The model the agent runs here, in big type, and how it runs: both words from the facts below. */
  readonly model: string;
  readonly runtime: string | null;
  /** The facts that say what the agent runs on this computer, in their words. */
  readonly agent: readonly Fact[];
  /** Ubuntu: the graphics card's video memory, in GB. */
  readonly videoMemory?: number;
  /** High-end Macs: the GPU's cores, at least. */
  readonly gpuCores?: number;
  /** 8 GB Macs: understanding images needs a cloud model. */
  readonly imagesInCloud: boolean;
}

const RUNS: Readonly<Record<DeviceId, Omit<DeviceRun, 'id' | 'name' | 'brand' | 'memory'>>> = {
  'mac-8': { orMore: false, model: 'A small text model', runtime: null, agent: [SMALL], imagesInCloud: true },
  'mac-16': { orMore: true, model: 'Qwen3.5 4B', runtime: 'through llama.cpp', agent: [AGENT_4B], imagesInCloud: false },
  'mac-32': { orMore: false, model: 'Qwen3.5 9B', runtime: 'on MLX', agent: [AGENT_9B], gpuCores: 16, imagesInCloud: false },
  ubuntu: { orMore: true, model: 'Qwen3.5 4B', runtime: 'through llama.cpp', agent: [AGENT_4B, ON_UBUNTU], videoMemory: 8, imagesInCloud: false },
};

export const DEVICE_RUNS: readonly DeviceRun[] = AI_DEVICES.map((d) => ({ id: d.id, name: d.name, brand: d.brand, memory: d.memory, ...RUNS[d.id] }));

/** The computer the server HTML shows: 16 GB, the agent's floor. */
export const DEFAULT_DEVICE: DeviceId = 'mac-16';

export function deviceRun(id: DeviceId): DeviceRun {
  return DEVICE_RUNS.find((d) => d.id === id) ?? DEVICE_RUNS[1]!;
}

/** How many of the meter's segments a size fills. */
export function segmentsFor(gb: number): number {
  return Math.max(0, Math.min(SEGMENTS, Math.round(gb / GB_PER_SEGMENT)));
}

/** Which computer an arrow key moves to from `index`, wrapping round. */
export function stepDevice(index: number, key: string): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return DEVICE_RUNS.length - 1;
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (!step) return null;
  return (index + step + DEVICE_RUNS.length) % DEVICE_RUNS.length;
}
