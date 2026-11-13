# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Render earshot's SFX bank into takes for the `sfx-bank` component (EAR1-D1): the build's Python stage.

    ~/.cache/taalcut-ear1/venv/bin/python -I tools/audio-packs/sfx-bank/render_bank.py [--work DIR] [--takes 2]
        [--only ID,ID] [--presets calm,crisp,minimal,launch] [--jobs 4]

Build time only: Python never runs in the app or in its tests. Needs upstream earshot at the pinned commit in the
venv (tools/earshot-parity/README.md). For every bank sound it renders `--takes` takes on the sound's own seed and
the next ones (a kit's take k is seed + k - 1), and every take the four presets' kits plan (pitches, widths), each
through earshot's own `kit.render_take`: audited with its category (and a preset take with its role) as context, a
failed take re-rolled on seed + 1000 j up to three times, as `kit render` does. Each take is quantised to 16 bits
here, so the measurements (onset, peak, end, momentary-max loudness) and the audit are of the samples that ship: 16
bits, or 24 where rounding to 16 changes the audit (a slow sub's peak rounds into a "flat top", a quiet tail into a
"click"), so quantising never fails a take that earshot passed.

Writes `<work>/raw/<file>.s16` or `.s24` (interleaved little-endian PCM at 48 kHz) and `<work>/render.json`: the bank
version, every sound's row (upstream's `sfx list`, its bank file, its fit source), every take and the presets'
plans. Deterministic: the same machine and venv write the same bytes (no timings, sorted keys).
"""
import argparse
import hashlib
import json
import multiprocessing as mp
import os
import sys

CACHE = os.path.expanduser('~/.cache/taalcut-ear1')
UPSTREAM_COMMIT = 'ff41f0788ae56896fd59879ab03858d223c06a53'
PRESETS = ('calm', 'crisp', 'minimal', 'launch')
SR = 48000


def settings(threads):
    """the environment earshot reads at import time (one BLAS thread per worker: the pool is the parallelism)"""
    os.environ.setdefault('EARSHOT_HOME', os.path.join(CACHE, 'earshot-home'))
    os.environ.setdefault('HF_HOME', os.path.join(CACHE, 'hf'))
    for key in ('EARSHOT_THREADS', 'OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'NUMBA_NUM_THREADS'):
        os.environ[key] = str(threads)
    os.environ.pop('EARSHOT_BANK', None)      # the shipped bank files only


def slug(sound_id):
    """a flat file-name stem for a bank id: 'fit/land.light/fingertip_book' -> 'fit.land-light.fingertip_book'"""
    return '.'.join(part.replace('.', '-') for part in sound_id.split('/'))


def take_name(t, used):
    label = ''
    if t.get('pitch') is not None:
        from earshot.forge import knobs
        label = f"_{knobs.label(t['pitch'])}"
    extra = {k: t[k] for k in ('edits', 'max_s', 'width') if t.get(k)}
    digest = f"_{hashlib.sha1(json.dumps(extra, sort_keys=True).encode()).hexdigest()[:8]}" if extra else ''
    return f"{slug(t['sound'])}_s{used}{label}{digest}"


def quantise(y, bits):
    """(PCM bytes, what a decoder hands back: FFmpeg divides by 2 ** (bits - 1))"""
    import numpy as np
    full = float(2 ** (bits - 1))
    q = np.clip(np.rint(np.asarray(y, np.float64) * (full - 1)), -full, full - 1).astype('<i4')
    data = q.astype('<i2').tobytes() if bits == 16 else q.reshape(-1).view('u1').reshape(-1, 4)[:, :3].tobytes()
    return data, q.astype(np.float64) / full


def apex_s(heard):
    """the loudest 5 ms at every sample (its centre, s): bank.times' peak without the 1 ms grid, so the instant a
    planner puts on a cut doesn't depend on where a measuring grid starts (a fluttering pass has near-equal maxima
    a grid shift can swap)"""
    import numpy as np
    m = np.asarray(heard, np.float64)
    m = m.mean(1) if m.ndim == 2 else m
    w = SR // 200
    if len(m) <= w:
        return round(len(m) / 2 / SR, 5)
    c = np.concatenate([[0.0], np.cumsum(m * m)])
    return round((int(np.argmax(c[w:] - c[:-w])) + w / 2) / SR, 5)


def audit_row(c):
    return {'ok': bool(c['ok']), 'warnings': [{'code': w['code'], 'msg': w['msg']} for w in c['warnings']],
            'notes': [{'code': n['code'], 'msg': n['msg']} for n in c['notes']]}


def render_one(job):
    """one planned take (kit.plan's shape, role None for a bank take): its file, seeds, measures and audits"""
    t, raw_dir = job
    from earshot.forge import bank, kit, knobs, sfx
    y, c_float, meta, used = kit.render_take(t)
    entry = bank.get(t['sound'])
    for bits in (16, 24):
        data, heard = quantise(y, bits)
        c = sfx.check(heard, category=entry['category'], role=t.get('role'), sound=t['sound'])
        bank.add_warning(c, knobs.pitch_warning(meta.get('edits')))
        if c['ok'] or not c_float['ok']:
            break
    name = take_name(t, used)
    path = os.path.join(raw_dir, f'{name}.s{bits}')
    with open(path + '.tmp', 'wb') as fh:
        fh.write(data)
    os.replace(path + '.tmp', path)
    m = bank.measure(heard)
    row = {'file': name, 'sound': t['sound'], 'seed': int(used), 'planned_seed': int(t['seed']),
           'upstream_audit': audit_row(c_float),
           'pitch': t.get('pitch'), 'edits': t.get('edits') or {}, 'max_s': t.get('max_s'), 'width': t.get('width'),
           'bits': bits, 'channels': 1 if heard.ndim == 1 else int(heard.shape[1]), 'frames': int(heard.shape[0]),
           'sha256': hashlib.sha256(data).hexdigest(), 'audit': audit_row(c),
           'apex_s': apex_s(heard),
           **{k: m[k] for k in ('onset_s', 'peak_s', 'end_s', 'dur_s', 'peak_db', 'lufs_m_max')}}
    if t.get('width') is not None:
        row['corr'] = round(float(kit.corr(heard)), 3)
    if t.get('role'):
        row['role'] = t['role']
    return row


def init_worker():
    settings(1)


def sound_rows():
    """upstream's `sfx list` rows, with each one's bank file and (fit) source"""
    from earshot.forge import bank
    where = bank._load()['where']
    rows = []
    for row in bank.list_sounds():
        e = bank.get(row['id'])
        row = dict(row)
        row['bank_file'] = os.path.splitext(os.path.basename(where[row['id']]))[0]
        row['own_seed'] = int(e['seed'])
        if e.get('source'):
            row['source'] = e['source']
        rows.append(row)
    return rows


def plans(rows, takes, presets):
    """(bank takes, preset takes): kit.plan-shaped dicts. A bank take has no role, so its audit is the category's"""
    from earshot.forge import kit
    base = [{'role': None, 'file': None, 'sound': r['id'], 'seed': r['own_seed'] + k, 'pitch': None, 'edits': {},
             'max_s': None, 'k': k + 1} for r in rows for k in range(takes)]
    kits = {name: kit.plan(kit.load(kit.preset(name))) for name in presets}
    return base, kits


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--work', default=os.path.join(CACHE, 'sfx-bank-work'))
    p.add_argument('--takes', type=int, default=2)
    p.add_argument('--only', help='comma-separated bank ids (a partial build, for tests and trials)')
    p.add_argument('--presets', default=','.join(PRESETS))
    p.add_argument('--jobs', type=int, default=4)
    a = p.parse_args(argv)
    settings(1)
    import earshot
    from earshot.forge import bank
    raw = os.path.join(a.work, 'raw')
    os.makedirs(raw, exist_ok=True)
    rows = sound_rows()
    only = set(a.only.split(',')) if a.only else None
    if only:
        unknown = only - {r['id'] for r in rows}
        if unknown:
            sys.exit(f'unknown ids: {sorted(unknown)}')
        rows = [r for r in rows if r['id'] in only]
    presets = [x for x in a.presets.split(',') if x] if not only else []
    base, kits = plans(rows, a.takes, presets)
    jobs, index = [], {}
    for t in base + [dict(t) for name in presets for t in kits[name]]:
        key = json.dumps([t['sound'], t['seed'], t['pitch'], t['edits'], t['max_s'], t.get('width'), t['role']],
                         sort_keys=True)
        if key not in index:
            index[key] = len(jobs)
            jobs.append(t)
    print(f'{len(rows)} sounds, {len(base)} bank takes, {len(jobs)} renders with the presets', file=sys.stderr)
    ctx = mp.get_context('spawn')
    with ctx.Pool(a.jobs, initializer=init_worker) as pool:
        done = pool.map(render_one, [(t, raw) for t in jobs], chunksize=1)
    takes = {}
    for row in done:
        prev = takes.get((row['file'], row.get('role')))
        if prev and prev['sha256'] != row['sha256']:
            sys.exit(f"{row['file']}: two renders of one take differ")
        takes[(row['file'], row.get('role'))] = row
    kit_refs = {}
    for name in presets:
        refs = []
        for t in kits[name]:
            key = json.dumps([t['sound'], t['seed'], t['pitch'], t['edits'], t['max_s'], t.get('width'), t['role']],
                             sort_keys=True)
            row = done[index[key]]
            refs.append({'role': t['role'], 'lock_file': t['file'], 'file': row['file'], 'k': t['k']})
        kit_refs[name] = refs
    import numpy
    import scipy
    doc = {'format': 1, 'upstream': {'repository': 'https://github.com/Leonxlnx/earshot', 'commit': UPSTREAM_COMMIT,
                                     'version': earshot.__version__, 'bank': bank.VERSION},
           'tools': {'python': sys.version.split()[0], 'numpy': numpy.__version__, 'scipy': scipy.__version__},
           'sr': SR, 'takes_per_sound': a.takes, 'sounds': rows,
           'takes': sorted(takes.values(), key=lambda r: (r['file'], r.get('role') or '')), 'kits': kit_refs}
    out = os.path.join(a.work, 'render.json')
    with open(out + '.tmp', 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=False) + '\n')
    os.replace(out + '.tmp', out)
    bad = [f"{r['file']} ({r.get('role') or 'bank'}): {', '.join(w['code'] for w in r['audit']['warnings'])}"
           for r in doc['takes'] if not r['audit']['ok']]
    print(f"wrote {out}: {len(doc['sounds'])} sounds, {len(doc['takes'])} takes, {len(bad)} not clean",
          file=sys.stderr)
    for line in bad:
        print('  ' + line, file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
