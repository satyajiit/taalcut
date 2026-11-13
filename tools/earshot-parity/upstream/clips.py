# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Stage 1: the clips. Generated clips and films come from the Node generator (generate-clips.mjs); the SFX clips
are upstream bank renders (`earshot sfx render`, the sound's own seed and length), downmixed to mono and rounded to
16-bit, committed under fixtures/clips/sfx and copied into the work folder next to the others."""
import json
import os
import shutil
import subprocess
import wave

import numpy as np

from common import CLIPS, FIXTURES, PARITY, WORK, clean, log, run_cli, sha256_file

SFX_DIR = os.path.join(FIXTURES, 'clips', 'sfx')


def node_catalogue(node='node'):
    """the SFX part of the clip catalogue (ids, sounds, files), read from gen/catalogue.mjs"""
    script = ("import('./gen/catalogue.mjs').then(m => process.stdout.write(JSON.stringify("
              "{sfx: m.SFX, generated: m.GENERATED.map(c => c.id), films: m.FILMS.map(c => c.id)})))")
    out = subprocess.run([node, '--input-type=module', '-e', script], cwd=PARITY, capture_output=True, text=True,
                         check=True)
    return json.loads(out.stdout)


def generate(node='node', ffmpeg='ffmpeg'):
    if os.path.isdir(CLIPS):
        shutil.rmtree(CLIPS)
    os.makedirs(CLIPS)
    subprocess.run([node, os.path.join(PARITY, 'generate-clips.mjs'), '--out', CLIPS, '--video', '--ffmpeg', ffmpeg],
                   check=True, stdout=subprocess.DEVNULL)
    with open(os.path.join(CLIPS, 'clips.json'), encoding='utf-8') as fh:
        return json.load(fh)


def _write_s16_mono(src, dst):
    """mean of the channels, rounded half up to 16-bit (what the Node reader decodes as int16 / 32768)"""
    import soundfile as sf
    x, sr = sf.read(src, dtype='float64', always_2d=True)
    m = x.mean(axis=1)
    q = np.clip(np.floor(m * 32768 + 0.5), -32768, 32767).astype('<i2')
    with wave.open(dst, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(q.tobytes())


def render_sfx(sfx, refresh=False):
    """render the bank sounds (when missing or refresh) into fixtures/clips/sfx; returns {clip id: render meta}"""
    os.makedirs(SFX_DIR, exist_ok=True)
    src_dir = os.path.join(WORK, 'sfx-src')
    os.makedirs(src_dir, exist_ok=True)
    metas = {}
    for c in sfx:
        sound, cid = c['params']['sound'], c['id']
        src = os.path.join(src_dir, f'{cid}.wav')
        res, code = run_cli(['sfx', 'render', sound, '-o', src], cwd=src_dir)
        if code != 0:
            raise RuntimeError(f'sfx render {sound}: {res}')
        res.pop('file', None)
        metas[cid] = {'argv': ['sfx', 'render', sound, '-o', f'{cid}.wav'], 'result': res,
                      'note': 'meta of the 24-bit stereo render; the committed clip is its mono 16-bit downmix'}
        dst = os.path.join(PARITY, 'fixtures', c['file'])
        if refresh or not os.path.exists(dst):
            _write_s16_mono(src, dst)
        shutil.copyfile(dst, os.path.join(CLIPS, f'{cid}.wav'))
    return metas


def clip_rows(generated, sfx):
    """one manifest row per clip: generated rows from clips.json, SFX rows from the committed files"""
    rows = []
    for r in generated:
        rows.append({k: r[k] for k in ('id', 'category', 'kind', 'file', 'sha256', 'bytes', 'sampleRate',
                                       'channels', 'samples', 'seconds', 'params', 'truth')} |
                    {'source': 'generated', 'format': 'f32'} | ({'video': r['video']} if r.get('video') else {}))
    for c in sfx:
        path = os.path.join(PARITY, 'fixtures', c['file'])
        with wave.open(path, 'rb') as w:
            n, sr, ch = w.getnframes(), w.getframerate(), w.getnchannels()
        rows.append({'id': c['id'], 'category': 'sfx', 'kind': 'bank', 'file': f"{c['id']}.wav",
                     'committed': c['file'], 'sha256': sha256_file(path), 'bytes': os.path.getsize(path),
                     'sampleRate': sr, 'channels': ch, 'samples': n, 'seconds': n / sr, 'params': c['params'],
                     'truth': {}, 'source': 'earshot sfx render', 'format': 's16'})
    log(f'clips: {len(rows)} ({sum(r["category"] == "film" for r in rows)} films)')
    return clean(rows)
