// Types for the vendored Emscripten module (written for Taalcut; the C API names are Signalsmith's).
export interface SignalsmithStretchModule {
  /** The module's memory; Float32Array views over HEAP8.buffer read and write the buffers. */
  readonly HEAP8: Int8Array;
  _presetDefault(channels: number, sampleRate: number): void;
  _presetCheaper(channels: number, sampleRate: number): void;
  _configure(channels: number, blockSamples: number, intervalSamples: number, splitComputation: boolean): void;
  _reset(): void;
  _inputLatency(): number;
  _outputLatency(): number;
  _blockSamples(): number;
  _intervalSamples(): number;
  /** Allocates `channels` input buffers then `channels` output buffers of `length` float samples each; returns the first one's byte offset. */
  _setBuffers(channels: number, length: number): number;
  _setTransposeFactor(factor: number, tonalityLimit: number): void;
  _setTransposeSemitones(semitones: number, tonalityLimit: number): void;
  _setFormantFactor(factor: number, compensatePitch: boolean): void;
  _setFormantSemitones(semitones: number, compensatePitch: boolean): void;
  _setFormantBase(baseFrequencyOverNyquist: number): void;
  /** Primes the stretcher with `inputSamples` from the input buffers at a playback-rate hint. */
  _seek(inputSamples: number, playbackRate: number): void;
  /** Reads `inputSamples` from the input buffers and writes `outputSamples` to the output buffers. */
  _process(inputSamples: number, outputSamples: number): void;
  /** Writes the remaining `outputSamples` to the output buffers. */
  _flush(outputSamples: number): void;
}

declare function SignalsmithStretch(moduleArg?: object): Promise<SignalsmithStretchModule>;
export default SignalsmithStretch;
