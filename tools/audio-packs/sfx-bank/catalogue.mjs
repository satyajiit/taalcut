// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `sfx-bank` catalogue from the Python stage's render.json (EAR1-D1): one item per bank sound with its family,
 * licence and provenance (families.mjs) and its clean takes, measured (ms from the sound's start, inside the
 * file's `padMs` of silence on each side) and audited; the shape
 * packages/audio/src/sfx/bank-catalogue.ts reads. Pure: no files, no FFmpeg.
 *
 * Refusals: an item without a licence or a source, an unknown category, an id core can't hold, a finding the
 * audit schema has no kind for: the build stops and names every one. A take that fails earshot's audit after its
 * re-rolls doesn't ship; a sound left with no clean take is withheld and listed with its warnings.
 */
import { familyOf, licensing, taalcutId, titleOf, UPSTREAM } from './families.mjs';

/** earshot's audit codes → core's SOUND_AUDIT_KINDS. */
export const AUDIT_KINDS = {
  clicks: 'click',
  edge: 'edge',
  clipping: 'clipping',
  dc: 'dc_offset',
  ring: 'ringing',
  silent: 'near_silent',
  silence: 'silence',
  rising_glide: 'rising_glide',
  truncated: 'truncated_tail',
  tail: 'tail_rise',
  stacked: 'stacked_attack',
  pre_swell: 'pre_swell',
};
/** The roles whose audit differs from the category's (earshot sfx.HIT_ROLES: stacked attacks, pre-swells). */
export const HIT_ROLES = ['hit', 'land'];
const ID = /^[a-z][a-z0-9_]*(?:\/[a-z0-9_]+)?$/;

const ms = (seconds) => Math.round(seconds * 10_000) / 10;
const fine = (seconds) => Math.round(seconds * 100_000) / 100;

function findings(audit, problems, where) {
  const out = [];
  for (const [severity, list] of [
    ['warning', audit.warnings],
    ['note', audit.notes],
  ])
    for (const f of list) {
      const kind = AUDIT_KINDS[f.code];
      if (!kind) problems.push(`${where}: audit code ${f.code} has no kind`);
      else out.push({ kind, severity, detail: String(f.msg).slice(0, 300) });
    }
  return { ok: audit.ok && audit.warnings.length === 0, findings: out };
}

function takeOf(row, problems) {
  if (Object.keys(row.edits ?? {}).length > 0 || row.max_s != null)
    problems.push(`${row.file}: edited takes are made at run time, not in the bank`);
  const take = {
    file: `${row.file}.flac`,
    seed: row.seed,
    plannedSeed: row.planned_seed,
    auditRole: HIT_ROLES.includes(row.role) ? row.role : null,
    pitch: row.pitch ?? null,
    width: row.width ?? null,
    bits: row.bits,
    channels: row.channels,
    frames: row.frames,
    durationMs: ms(row.dur_s),
    onsetMs: ms(row.onset_s),
    apexMs: fine(row.apex_s),
    peakMs: ms(row.peak_s),
    endMs: ms(row.end_s),
    peakDb: row.peak_db,
    loudnessLufs: Math.max(-70, Math.min(0, row.lufs_m_max)),
    pcmSha256: row.sha256,
    audit: findings(row.audit, problems, row.file),
  };
  if (row.corr != null) take.corr = row.corr;
  return take;
}

/** The takes of one sound, one per audio file and audit context, clean ones only. */
function takesOf(rows, problems) {
  const byKey = new Map();
  for (const row of rows) {
    const take = takeOf(row, problems);
    const key = `${take.file}|${take.auditRole ?? ''}`;
    const prev = byKey.get(key);
    if (prev && (prev.pcmSha256 !== take.pcmSha256 || prev.audit.ok !== take.audit.ok))
      problems.push(`${take.file}: one take, two different renders or audits`);
    if (!prev) byKey.set(key, take);
  }
  const all = [...byKey.values()];
  const order = (t) => [t.auditRole ?? '', t.pitch ?? '', t.width ?? -1, t.plannedSeed, t.file];
  const clean = all
    .filter((t) => t.audit.ok)
    .sort((a, b) => {
      const [x, y] = [order(a), order(b)];
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
      return 0;
    });
  const warnings = [
    ...new Set(
      all.flatMap((t) => t.audit.findings.filter((f) => f.severity === 'warning').map((f) => f.kind)),
    ),
  ];
  return { clean, warnings };
}

function knobsOf(row) {
  const k = row.knobs ?? {};
  const p = k.pitch;
  const pitch =
    p && typeof p.native_hz === 'number' && Array.isArray(p.range_hz)
      ? { nativeHz: p.native_hz, note: p.note ?? null, rangeHz: [p.range_hz[0], p.range_hz[1]] }
      : null;
  return { dur: k.dur ?? 'trim', apex: k.apex === true, pitch };
}

/**
 * `{ catalogue, files }` for `render` (render.json), or a thrown Error naming every refused item. `files` are the
 * take files the catalogue names, in catalogue order.
 */
export function bankCatalogue(render, { packVersion, padMs = 0 }) {
  const problems = [];
  const items = [];
  const withheld = [];
  const ids = new Set();
  const rowsBySound = Map.groupBy(render.takes, (row) => row.sound);
  for (const row of [...render.sounds].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const where = row.id;
    const id = (() => {
      try {
        return taalcutId(row.id);
      } catch {
        return null;
      }
    })();
    if (!id || !ID.test(id) || id.length > 64) problems.push(`${where}: id ${id} is not a bank sound id`);
    else if (ids.has(id)) problems.push(`${where}: id ${id} twice`);
    ids.add(id);
    const family = familyOf(row);
    if (!family) problems.push(`${where}: category ${row.category} has no family`);
    const licence = licensing(row);
    for (const p of licence.problems) problems.push(`${where}: ${p}`);
    if (licence.problems.length > 0 || !licence.licence || !licence.sourceUrl) continue;
    const { clean, warnings } = takesOf(rowsBySound.get(row.id) ?? [], problems);
    if (clean.length === 0) {
      withheld.push({ id, upstreamId: row.id, warnings });
      continue;
    }
    items.push({
      id,
      upstreamId: row.id,
      category: row.category,
      member: row.member,
      seed: row.own_seed,
      title: titleOf(row),
      family,
      kinds: row.kinds ?? [],
      source: row.bank_file,
      licence: licence.licence,
      sourceUrl: licence.sourceUrl,
      credit: licence.credit,
      provenance: licence.provenance,
      notes: String(row.notes ?? '').slice(0, 600),
      knobs: knobsOf(row),
      takes: clean,
    });
  }
  if (problems.length > 0) throw new Error(`the sfx-bank build refuses:\n  ${problems.join('\n  ')}`);
  const catalogue = {
    version: 1,
    pack: 'sfx-bank',
    packVersion,
    upstream: { ...UPSTREAM, version: render.upstream.version, bank: render.upstream.bank },
    sampleRate: render.sr,
    padMs,
    items,
    withheld,
    embeddings: [],
  };
  return { catalogue, files: items.flatMap((item) => [...new Set(item.takes.map((t) => t.file))]) };
}
