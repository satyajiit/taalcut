# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Stage 3: upstream's CLI on every clip. Each fixture file under fixtures/cli is {run id: {argv, result}}, where
argv is the exact `earshot` command line (run with --json from the clips folder, so paths are bare file names)
and result is the JSON it wrote, minus wall-clock timings."""
import os
import shutil

from common import CLIPS, FIXTURES, WORK, clean, log, run_cli, write_json
from queries import AB, COMPARE, FIND, HINTS, MATCH_FIXED, NOISE_ALTS, RANK, SFX_QUERY, TIMELINE_CLIPS

CLI = os.path.join(FIXTURES, 'cli')
PRESETS = ('calm', 'crisp', 'minimal', 'launch')


def wav(cid):
    return f'{cid}.wav'


class Runs:
    def __init__(self, name):
        self.name = name
        self.runs = {}
        self.failed = []

    def run(self, rid, argv, allow_fail=False, drop=()):
        res, code = run_cli(argv)
        for key in drop:   # derived text renderings, left out for size (the summary stays)
            res.pop(key, None)
        if code != 0 and not allow_fail:
            self.failed.append(rid)
            log(f'  {self.name} {rid}: exit {code}: {str(res.get("error") or res.get("summary"))[:160]}')
        self.runs[rid] = {'argv': argv, 'exit': code, 'result': res}
        return res

    def write(self):
        write_json(os.path.join(CLI, f'{self.name}.json'), self.runs, rows=True)
        log(f'  {self.name}: {len(self.runs)} runs' + (f', {len(self.failed)} failed' if self.failed else ''))
        return self.runs


def per_clip(name, ids, argv_of, allow_fail=False):
    r = Runs(name)
    for cid in ids:
        r.run(cid, argv_of(cid), allow_fail)
    return r.write()


def match_runs(rows, borderline):
    r = Runs('match')
    for cid, q in SFX_QUERY.items():
        r.run(f'{cid}::alts', ['match', wav(cid), q, '--alts', *NOISE_ALTS])
        r.run(f'{cid}::queries', ['match', wav(cid), q, 'a dog barking', *HINTS])
    for name, cid, qs, alts, start, end in MATCH_FIXED:
        argv = ['match', wav(cid), *qs] + (['--alts', *alts] if alts else [])
        argv += (['--start', str(start)] if start is not None else []) + (['--end', str(end)] if end is not None else [])
        rid = f'{cid}::{name}' + (f'@{start:g}-{end:g}' if start is not None else '')
        r.run(rid, argv)
    for cid, terms in borderline.items():
        r.run(f'{cid}::borderline', ['match', wav(cid), *[t['term'] for t in terms]])
    return r.write()


def rank_runs(rows):
    sfx = [wav(c['id']) for c in rows if c['category'] == 'sfx']
    r = Runs('rank')
    for q in RANK:
        r.run(q, ['rank', q, *sfx])
    r.run(f'{RANK[0]}::top3', ['rank', RANK[0], *sfx, '--top', '3'])
    return r.write()


def find_runs():
    r = Runs('find')
    for cid, q, extra in FIND:
        r.run(f'{cid}::{q}' + (f"::{' '.join(extra)}" if extra else ''), ['find', wav(cid), q, *extra])
    return r.write()


def compare_runs():
    r = Runs('compare')
    for cid, refs in COMPARE:
        r.run(cid, ['compare', wav(cid), '--refs', *[wav(x) for x in refs]])
    return r.write()


def ab_runs():
    r = Runs('ab')
    for i, (a, b, q, refs, extra) in enumerate(AB):
        argv = ['ab', wav(a), wav(b)] + (['--query', q] if q else []) + (['--refs', *map(wav, refs)] if refs else [])
        r.run(f'{i:02d}:{a}~{b}', argv + extra)
    return r.write()


def timeline_runs(rows):
    r = Runs('timeline')
    for c in rows:
        if c['category'] == 'film':
            r.run(c['id'], ['timeline', wav(c['id']), '--video', c['video'], '--detail', 'normal'], drop=('text',))
        elif c['category'] == 'music' or c['id'] in TIMELINE_CLIPS:
            r.run(c['id'], ['timeline', wav(c['id']), '--detail', 'normal'], drop=('text',))
    return r.write()


def critique_runs(rows):
    r = Runs('critique')
    for c in rows:
        if c['category'] == 'film':
            res = r.run(c['id'], ['critique', wav(c['id']), '--video', c['video']], drop=('text',))
            res.pop('seconds', None)
    return r.write()


def sfx_check_runs(rows):
    r = Runs('sfx-check')
    for c in rows:
        if c['category'] == 'sfx':
            r.run(c['id'], ['sfx', 'check', wav(c['id'])], allow_fail=True)
            cat = c['params']['sound'].split('/')[0]
            r.run(f"{c['id']}::category", ['sfx', 'check', wav(c['id']), '--category', cat], allow_fail=True)
    return r.write()


def kit_runs():
    """kit init + kit render per preset: kit.json and kit.lock.json (per-take seed, pitch, onset, peak, end, sha1)"""
    root = os.path.join(WORK, 'kits')
    shutil.rmtree(root, ignore_errors=True)
    out = {}
    for preset in PRESETS:
        d = os.path.join(root, preset)
        os.makedirs(d)
        init, code = run_cli(['kit', 'init', '--preset', preset, '-o', 'kit.json'], cwd=d, out_file=False)
        if code != 0:
            raise RuntimeError(f'kit init {preset}: {init}')
        _, code = run_cli(['kit', 'render', 'kit.json', '--out', 'takes'], cwd=d, out_file=False)
        if code != 0:
            raise RuntimeError(f'kit render {preset} failed')
        dst = os.path.join(FIXTURES, 'kits', preset)
        os.makedirs(dst, exist_ok=True)
        shutil.copyfile(os.path.join(d, 'kit.json'), os.path.join(dst, 'kit.json'))
        shutil.copyfile(os.path.join(d, 'takes', 'kit.lock.json'), os.path.join(dst, 'kit.lock.json'))
        out[preset] = {'init': ['kit', 'init', '--preset', preset, '-o', 'kit.json'],
                       'render': ['kit', 'render', 'kit.json', '--out', 'takes']}
    log(f'  kits: {", ".join(PRESETS)}')
    return out


def run_all(rows, borderline, sfx_meta, only=None):
    ids = [c['id'] for c in rows]
    write_json(os.path.join(CLI, 'sfx-render.json'), clean(sfx_meta), rows=True)
    steps = [
        ('describe', lambda: per_clip('describe', ids, lambda c: ['describe', wav(c)])),
        ('measure', lambda: per_clip('measure', ids, lambda c: ['measure', wav(c), '--music'])),
        ('realness', lambda: per_clip('realness', ids, lambda c: ['realness', wav(c)])),
        ('match', lambda: match_runs(rows, borderline)),
        ('rank', lambda: rank_runs(rows)),
        ('find', find_runs),
        ('compare', compare_runs),
        ('ab', ab_runs),
        ('sfx-check', lambda: sfx_check_runs(rows)),
        ('kit', kit_runs),
        ('timeline', lambda: timeline_runs(rows)),
        ('critique', lambda: critique_runs(rows)),
    ]
    out = {}
    import time
    for name, fn in steps:
        if only and name not in only:
            continue
        t = time.time()
        out[name] = fn()
        log(f'cli {name}: {time.time() - t:.0f} s')
    return out


if not os.path.isdir(CLIPS):
    os.makedirs(CLIPS, exist_ok=True)
