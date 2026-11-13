# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Build the earshot parity fixtures: clips, model and DSP intermediates, upstream CLI results, manifest.

    ~/.cache/taalcut-ear1/venv/bin/python tools/earshot-parity/upstream/build.py [--stages clips,inter,cli,manifest]

Build time only (Python never runs in the app or in tests). Needs upstream earshot at the pinned commit installed in
the venv (README.md), FFmpeg on PATH (earshot decodes with it) and Node 24.
"""
import argparse
import json
import os
import platform
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402  (sets EARSHOT_* before earshot is imported)
from common import FIXTURES, UPSTREAM_COMMIT, WORK, Blobs, log, sha256_file, write_json  # noqa: E402

INTER = os.path.join(FIXTURES, 'intermediates')
STATE = os.path.join(WORK, 'state.json')


def versions(node, ffmpeg):
    import importlib.metadata as md
    pk = ['numpy', 'scipy', 'torch', 'transformers', 'tokenizers', 'librosa', 'soxr', 'soundfile', 'pyloudnorm',
          'scikit-learn', 'huggingface-hub', 'safetensors', 'earshot']
    out = {'python': platform.python_version(), 'platform': f'{platform.system()} {platform.machine()}',
           'threads': int(os.environ['EARSHOT_THREADS'])}
    out.update({p: md.version(p) for p in pk})
    out['node'] = subprocess.run([node, '--version'], capture_output=True, text=True).stdout.strip()
    out['ffmpeg'] = subprocess.run([ffmpeg, '-version'], capture_output=True, text=True).stdout.split('\n')[0]
    return out


def models():
    from earshot.models import ast, clap
    c, t = clap.get(), ast.get()
    out = {}
    for name, m in (('clap', c), ('ast', t)):
        w = os.path.join(m.spec.snapshot, m.spec.weights)
        out[name] = {'id': m.model_id, 'revision': m.revision, 'weights': m.spec.weights,
                     'weightsSha256': sha256_file(w), 'precision': m.precision, 'dtype': str(m.dtype)}
    assert c.precision == 'fp32' and t.precision == 'fp32', 'fixtures must be fp32'
    return out


def stage_clips(node, ffmpeg):
    import clips
    cat = clips.node_catalogue(node)
    generated = clips.generate(node, ffmpeg)
    sfx_meta = clips.render_sfx(cat['sfx'])
    rows = clips.clip_rows(generated, cat['sfx'])
    return {'rows': rows, 'sfx_meta': sfx_meta}


def stage_inter(state):
    import inter_dsp
    import inter_models
    import queries
    rows = state['rows']
    blobs = Blobs(INTER)
    qs = queries.all_queries()
    t = time.time()
    v, Q, text = inter_models.text(blobs, qs)
    log(f'inter text: {time.time() - t:.0f} s')
    t = time.time()
    emb, pooled = inter_models.audio_embeddings(blobs, rows, v, Q)
    border = inter_models.borderline(v, rows, set(queries.BORDERLINE), pooled)
    feats = inter_models.clap_features(blobs, rows)
    log(f'inter clap audio: {time.time() - t:.0f} s')
    t = time.time()
    ast_out = inter_models.ast_outputs(blobs, rows)
    log(f'inter ast: {time.time() - t:.0f} s')
    t = time.time()
    parts = {'text': text, 'clap-audio': emb, 'borderline': border, 'clap-features': feats, 'ast': ast_out,
             'onsets': inter_dsp.onsets(blobs, rows), 'beats': inter_dsp.beats(blobs, rows),
             'sections': inter_dsp.sections(blobs, rows), 'realness': inter_dsp.realness(blobs, rows)}
    log(f'inter dsp / sections / realness: {time.time() - t:.0f} s')
    for name, obj in parts.items():
        write_json(os.path.join(INTER, f'{name}.json'), common.clean(obj))
    files = blobs.write()
    write_json(os.path.join(INTER, 'index.json'), {'format': 'little-endian float32, row-major',
                                                   'files': files, 'arrays': blobs.index})
    return {'borderline': border, 'queries': qs}


def stage_cli(state, only=None):
    import commands
    return commands.run_all(state['rows'], state['borderline'], state['sfx_meta'], only)


def stage_manifest(state, node, ffmpeg):
    files = {}
    for root, _, names in os.walk(FIXTURES):
        for n in sorted(names):
            p = os.path.join(root, n)
            rel = os.path.relpath(p, FIXTURES).replace(os.sep, '/')
            if rel == 'manifest.json' or n.startswith('.'):
                continue
            files[rel] = {'sha256': sha256_file(p), 'bytes': os.path.getsize(p)}
    from earshot import __version__
    from earshot.forge import bank
    manifest = {
        'schema': 1,
        'upstream': {'repository': 'https://github.com/Leonxlnx/earshot', 'commit': UPSTREAM_COMMIT,
                     'version': __version__, 'licence': 'MIT', 'bank': bank.VERSION},
        'models': models(),
        'settings': {k: os.environ[k] for k in ('EARSHOT_PRECISION', 'EARSHOT_THREADS')},
        'versions': versions(node, ffmpeg),
        'generator': {'script': 'tools/earshot-parity/generate-clips.mjs', 'sampleRate': 48000,
                      'note': 'generated clips are float32 WAV, regenerated by tests (fixtures.mjs); SFX clips are '
                              'committed 16-bit mono WAV under clips/sfx'},
        'queries': state['queries'],
        'borderline': state['borderline'],
        'clips': state['rows'],
        'files': dict(sorted(files.items())),
        'totalBytes': sum(f['bytes'] for f in files.values()),
    }
    write_json(os.path.join(FIXTURES, 'manifest.json'), manifest)
    log(f'manifest: {len(manifest["clips"])} clips, {len(files)} files, {manifest["totalBytes"] / 1e6:.2f} MB')


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--stages', default='clips,inter,cli,manifest')
    ap.add_argument('--node', default='node')
    ap.add_argument('--ffmpeg', default='ffmpeg')
    ap.add_argument('--cli', help='only these CLI steps (describe,measure,...,kit,timeline,critique)')
    a = ap.parse_args()
    stages = a.stages.split(',')
    state = {}
    if os.path.exists(STATE):
        with open(STATE, encoding='utf-8') as fh:
            state = json.load(fh)
    clock = {}
    for name, fn in (('clips', lambda: stage_clips(a.node, a.ffmpeg)), ('inter', lambda: stage_inter(state)),
                     ('cli', lambda: stage_cli(state, a.cli and a.cli.split(','))), ('manifest', lambda: stage_manifest(state, a.node, a.ffmpeg))):
        if name not in stages:
            continue
        t = time.time()
        res = fn()
        if isinstance(res, dict) and name in ('clips', 'inter'):
            state.update(res)
            write_json(STATE, state)
        clock[name] = round(time.time() - t, 1)
        log(f'== stage {name}: {clock[name]} s')
    log(f'done: {clock}')


if __name__ == '__main__':
    main()
