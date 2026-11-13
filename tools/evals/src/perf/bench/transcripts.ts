// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which engine transcribed (the audio lane's kinds, specs/requests-audio-to-bench.md): `audio.transcribeAssetWhisper`
 * (persistent whisper-server), `audio.transcribeAssetParakeet` (only when the Parakeet Core ML component is
 * installed; the indexing e2e seeds none yet), or `audio.transcribeAsset` (before IX). Counted per run from the
 * `audio.transcript` stage rows' jobs; a stage skipped as silent has no job.
 */
export interface TranscriptJobs {
  /** Job kind → stage rows it ran. */
  readonly kinds: Readonly<Record<string, number>>;
  /** Stage rows that ran no job (skipped: silent, or nothing to transcribe). */
  readonly skipped: number;
}

/** An engine's name from its job kind. */
export function engineOf(kind: string): string {
  if (/parakeet/i.test(kind)) return 'Parakeet';
  if (/whisper/i.test(kind)) return 'whisper';
  return kind === 'audio.transcribeAsset' ? 'whisper (before IX)' : kind;
}

/** summary.md's line: the engines over every run, with the kinds behind them. */
export function transcriptLine(runs: readonly (TranscriptJobs | null)[]): string {
  const counted = runs.filter((run): run is TranscriptJobs => run !== null);
  if (counted.length === 0) return 'Transcript engine: not read (no timeline).';
  const kinds = new Map<string, number>();
  for (const run of counted)
    for (const [kind, count] of Object.entries(run.kinds)) kinds.set(kind, (kinds.get(kind) ?? 0) + count);
  const engines = [...new Set([...kinds.keys()].map(engineOf))];
  const perRun = [...kinds.entries()]
    .map(([kind, count]) => `${kind} ${Math.round((count / counted.length) * 10) / 10} per run`)
    .join(', ');
  const skipped = counted.reduce((sum, run) => sum + run.skipped, 0) / counted.length;
  return (
    `Transcript engine: ${engines.length === 0 ? 'none ran' : engines.join(' and ')}` +
    `${engines.includes('Parakeet') ? '' : ' (Parakeet component absent)'}` +
    `${perRun === '' ? '' : `; ${perRun}`}${skipped > 0 ? `; ${Math.round(skipped * 10) / 10} skipped per run` : ''}.`
  );
}
