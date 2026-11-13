# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Shared pieces of the fixture build: settings, the in-process CLI runner, JSON and float32 blob writers.

Import this module before anything from earshot: it pins the settings earshot reads at import time (fp32, threads,
caches under ~/.cache/taalcut-ear1).
"""
import contextlib
import hashlib
import io
import json
import os
import sys

CACHE = os.path.expanduser('~/.cache/taalcut-ear1')
os.environ.setdefault('EARSHOT_HOME', os.path.join(CACHE, 'earshot-home'))
os.environ.setdefault('HF_HOME', os.path.join(CACHE, 'hf'))
os.environ['EARSHOT_PRECISION'] = 'fp32'   # never bf16 for fixtures (bf16 is only used on AVX512-BF16 / AMX CPUs)
os.environ.setdefault('EARSHOT_THREADS', '4')
os.environ.setdefault('OPENBLAS_NUM_THREADS', os.environ['EARSHOT_THREADS'])
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')

import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PARITY = os.path.dirname(HERE)
FIXTURES = os.path.join(PARITY, 'fixtures')
WORK = os.path.join(os.environ['EARSHOT_HOME'], 'parity')
CLIPS = os.path.join(WORK, 'clips')
UPSTREAM_COMMIT = 'ff41f0788ae56896fd59879ab03858d223c06a53'
# Keys whose values change from run to run (wall-clock timings, cache hits): dropped from every fixture.
VOLATILE = {'timing_s', 'cached', 'seconds_elapsed'}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def clean(o, volatile=VOLATILE):
    """upstream's report._clean (numpy -> plain, NaN / inf -> None), minus volatile keys"""
    from earshot.report import _clean
    o = _clean(o)

    def strip(v):
        if isinstance(v, dict):
            return {k: strip(x) for k, x in v.items() if k not in volatile}
        if isinstance(v, list):
            return [strip(x) for x in v]
        return v
    return strip(o)


def write_json(path, obj, rows=False):
    """compact JSON; rows=True puts each top-level entry of a dict on its own line (readable diffs)"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if rows and isinstance(obj, dict):
        body = ',\n'.join(f'{json.dumps(k)}:{json.dumps(v, ensure_ascii=False, separators=(",", ":"))}'
                          for k, v in obj.items())
        text = '{\n' + body + '\n}\n'
    else:
        text = json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n'
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    return path


def run_cli(argv, cwd=CLIPS, out_file=True):
    """run `earshot <argv> --json [--out <tmp>]` in this process (models stay warm) and return (result, exit code):
    the JSON the CLI writes (out_file) or prints (the kit commands, whose --out is their takes folder), or
    {'error'} when it fails without a result"""
    from earshot import cli
    out = os.path.join(WORK, 'last-cli.json')
    if os.path.exists(out):
        os.remove(out)
    stdout, stderr = io.StringIO(), io.StringIO()
    prev = os.getcwd()
    os.chdir(cwd)
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                code = cli.main([*argv, '--json'] + (['--out', out] if out_file else []))
            except SystemExit as e:   # argparse
                code = e.code if isinstance(e.code, int) else 2
    finally:
        os.chdir(prev)
    if out_file and os.path.isfile(out):
        with open(out, encoding='utf-8') as fh:
            return clean(json.load(fh)), code
    text = stdout.getvalue().strip()
    try:
        res = json.loads(text[text.index('{'):]) if '{' in text else {}
    except ValueError:
        res = {}
    if not res or code != 0:
        res.setdefault('error', (stderr.getvalue().strip() or text)[:400])
    return clean(res), code


class Blobs:
    """float32 arrays grouped into one little-endian .f32 file per group, with an index entry per array:
    {group, file, offset (floats), shape, sha256 of the array's bytes}"""

    def __init__(self, root):
        self.root = root
        self.groups = {}
        self.index = {}

    def add(self, group, key, arr, **meta):
        a = np.ascontiguousarray(np.asarray(arr, dtype='<f4'))
        buf = self.groups.setdefault(group, [])
        offset = sum(x.size for x in buf)
        buf.append(a.reshape(-1))
        self.index[f'{group}/{key}'] = dict(meta, group=group, file=f'{group}.f32', offset=int(offset),
                                            shape=list(a.shape),
                                            sha256=hashlib.sha256(a.tobytes()).hexdigest())
        return a

    def write(self):
        os.makedirs(self.root, exist_ok=True)
        files = {}
        for group, parts in self.groups.items():
            path = os.path.join(self.root, f'{group}.f32')
            data = np.concatenate(parts).astype('<f4') if parts else np.zeros(0, '<f4')
            data.tofile(path)
            files[f'{group}.f32'] = {'floats': int(data.size), 'sha256': sha256_file(path)}
        return files


def log(msg):
    print(msg, file=sys.stderr, flush=True)
