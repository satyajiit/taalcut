# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Stage 2b: DSP, section and realness intermediates through upstream's own functions (earshot.timeline,
earshot.realness): the superflux onset curve, its robust z and picks, detected events, level envelopes, the pulse
envelopes and tempo candidates, beat grids, section windows and Foote novelty, and the realness heads per window."""
import os

import numpy as np
from scipy import ndimage

from common import CLIPS, clean, log

ONSET_CLIPS = ['film-00', 'music-120-fmaj', 'sfx-typing-key-thock', 'speech-01', 'edge-clipped']
LOGMEL_CLIPS = ['sfx-typing-key-thock']
LEVEL_CLIPS = ['film-00', 'film-01']
PULSE_CLIPS = ['music-080-cmaj', 'music-120-fmaj', 'music-150-amaj', 'music-170-fsmin']
SECTION_CLIPS = ['edge-long-70s', 'film-00', 'music-100-emin', 'mix-speech-over-music']
# music clips whose realness windows are stored (every other clip's are, unless they equal its describe window)
REALNESS_MUSIC = ['music-080-cmaj', 'music-120-fmaj', 'music-170-fsmin']


def path_of(row):
    return os.path.join(CLIPS, row['file'])


def onsets(blobs, rows):
    """superflux onset strength (5 ms frames), its robust z (401 frames), the picked frames and the events"""
    from earshot import audio, timeline as T
    out = {}
    for r in rows:
        if r['id'] not in ONSET_CLIPS:
            continue
        x = audio.load(path_of(r))
        m = audio.to_mono(x).astype(np.float32)
        odf = T.onset_curve(m)
        z = T._robust_z(odf, 401)
        loc = (odf == ndimage.maximum_filter1d(odf, 11)) & (z >= 3.0) & (odf > 0)
        blobs.add('onset-odf', r['id'], odf)
        blobs.add('onset-z', r['id'], z)
        if r['id'] in LOGMEL_CLIPS:
            blobs.add('onset-logmel', r['id'], T.log_mel(m))
        out[r['id']] = {'hop': T.HOP, 'frames': int(len(odf)), 'picked': np.where(loc)[0].tolist(),
                        'events': clean(T.detect_events(x))}
    for r in rows:
        if r['id'] in LEVEL_CLIPS:
            envs = T.level_envs(audio.load(path_of(r)))
            blobs.add('level-envs', r['id'], np.stack([envs['full'], envs['high']]), bands=['full', 'high'])
    log(f'  onsets: {len(out)} clips')
    return out


def beats(blobs, rows):
    """tempo candidates per pulse envelope (broadband, low band) and the beat grid, for every clip >= 5 s with a
    beat (music, films, the mix and the long clip)"""
    from earshot import audio, timeline as T
    out = {}
    for r in rows:
        if r['category'] not in ('music', 'film', 'mix') and r['id'] != 'edge-long-70s':
            continue
        m = audio.to_mono(audio.load(path_of(r)))
        envs = T._pulse_envs(m)
        cands = []
        for env in envs:
            res = T._period(env, 60, 200)
            cands.append(None if res is None else {'period': res[0], 'clarity': res[1], 'score': res[2]})
        if r['id'] in PULSE_CLIPS:
            blobs.add('pulse-envs', r['id'], np.stack(envs), envs=['broadband', 'low'])
        out[r['id']] = {'candidates': cands, 'grid': clean(T.music_grid(m))}
    log(f'  beats: {len(out)} clips')
    return out


def sections(blobs, rows):
    """the 3 s / 2 s CLAP section windows (normal detail) and their embeddings, and the Foote novelty peaks"""
    from earshot import audio, timeline as T
    from earshot.models import clap
    c = clap.get()
    cfg = T.DETAIL['normal']
    out = {}
    for r in rows:
        if r['id'] not in SECTION_CLIPS:
            continue
        x = audio.load(path_of(r))
        dur = len(x) / audio.SR
        win = cfg['win']
        hop = max(cfg['hop'], round((dur - win) / max(1, cfg['max_win'] - 1), 2))
        starts = list(np.arange(0.0, max(dur - win, 0.0) + 1e-6, hop))
        if not starts or starts[-1] + win < dur - 0.5:
            starts.append(max(0.0, dur - win))
        spans = [(round(float(s), 3), round(min(dur, float(s) + win), 3)) for s in starts]
        A = c.embed_audio([T._seg(x, a, b) for a, b in spans], pad='repeatpad')
        blobs.add('section-windows', r['id'], A)
        nov = T.novelty_bounds(audio.to_mono(x).astype(np.float32))
        out[r['id']] = {'win': win, 'hop': hop, 'spans': spans, 'novelty': [list(p) for p in nov]}
    log(f'  sections: {len(out)} clips')
    return out


def realness(blobs, rows):
    """per clip: the lift, the windows, each window's signal features, head logits (clap, signal), fused p_real
    and the pure-tone rule, the 12 prompt embeddings (c.embed_text, no templates) and, per clip, where the CLAP
    embeddings the clap head read are: its describe window (one window, no lift), realness/<id> (other clips but
    films and most music, for size) or nowhere (null)"""
    from earshot import audio, realness as R
    from earshot.models import clap
    c = clap.get()
    m = R.load_model()
    P = c.embed_text(m['prompts']['real'] + m['prompts']['synth'])
    blobs.add('realness', 'prompts', P)
    out = {'prompts': m['prompts']['real'] + m['prompts']['synth'], 'clips': {}}
    for r in rows:
        x, gain, rdb, pdb = R.lift_quiet(audio.load(path_of(r), mono=True))
        spans = R._clips(x)
        scored = R.score_clips([w for _, _, w in spans], m)
        live = [i for i, s in enumerate(scored) if s]
        wins, where = [], None
        if live:
            E = c.embed_audio([spans[i][2] for i in live])
            if len(spans) == 1 and gain == 0:
                where = f"clap-audio-windows/{r['id']}"    # the same mono decode, one repeat-padded window
            elif r['category'] != 'film' and (r['category'] != 'music' or r['id'] in REALNESS_MUSIC):
                where = f"realness/{r['id']}"
                blobs.add('realness', r['id'], E, windows=live)
        for i, ((t0, t1, _), s) in enumerate(zip(spans, scored)):
            row = {'start': round(t0, 6), 'end': round(t1, 6), 'live': bool(s)}
            if s:
                row.update(features=s['features'], logits=s['logits'], p_real=s['p_real'], tone=bool(s['tone']))
                lc, _ = R.head_logit(m['heads']['clap'], E[live.index(i)])
                row['clapLogitCheck'] = lc
            wins.append(row)
        out['clips'][r['id']] = clean({'gain_db': gain, 'rms_db': rdb, 'peak_db': pdb, 'embeddings': where,
                                       'windows': wins})
    log(f'  realness: {len(out["clips"])} clips')
    return out
