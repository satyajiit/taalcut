// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The audio thread's side of the consent recording: hands the microphone's first channel to the window in blocks
 * of 2048 samples (about 43 ms at 48 kHz), copied, so the window can meter and send them. Loaded with
 * audioWorklet.addModule (microphone.ts); runs in the AudioWorkletGlobalScope, not the window.
 */

/** What the AudioWorkletGlobalScope gives a processor (TypeScript's DOM library doesn't describe that scope). */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const BLOCK = 2048;

class PcmTap extends AudioWorkletProcessor {
  private block = new Float32Array(BLOCK);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(BLOCK - this.filled, channel.length - offset);
      this.block.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === BLOCK) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(BLOCK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-tap', PcmTap);

// A module, so the declarations above stay in this file.
export {};
