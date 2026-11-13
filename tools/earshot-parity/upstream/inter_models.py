# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Stage 2a: model intermediates through upstream's Python API: CLAP text (vocabulary, queries, per-template rows,
token ids), CLAP audio (per-window and pooled embeddings, front-end log-mel), calibration (cos, u, z), AST (logits,
fbank, the 16 kHz resample)."""
import os
import warnings

import numpy as np

from common import CLIPS, log

FEATURE_CLIPS = [('sfx-whoosh-fast-crisp', 0), ('speech-01', 0), ('music-080-cmaj', 0)]   # (clip, CLAP window)
AST_CLIPS = ['sfx-whoosh-fast-crisp', 'speech-01', 'music-120-fmaj', 'edge-pure-tone', 'texture-rain', 'film-00']
FBANK_CLIPS = ['sfx-whoosh-fast-crisp', 'speech-01']
FBANK_FRAMES = 256
UZ_CLIPS = ['sfx-whoosh-fast-crisp', 'sfx-click-double', 'music-120-fmaj', 'speech-01', 'texture-rain',
            'edge-near-silent']
TEMPLATE_TERMS = ['a fast air whoosh', 'a single mechanical keyboard key press', 'a mouse click', 'heavy rain falling',
                  'upbeat electronic dance music', 'a man speaking', 'a deep cinematic boom', 'a glass ting']
THRESHOLDS = (2.0, 2.5, 3.0)


def path_of(row):
    return os.path.join(CLIPS, row['file'])


def text(blobs, queries):
    """vocabulary and query embeddings exactly as earshot.vocab makes them, plus the raw rows behind them"""
    from earshot import vocab
    from earshot.models import clap
    v = vocab.get()
    c = clap.get()
    blobs.add('clap-text', 'vocab', v.E)
    Q = v.embed_text(queries)
    blobs.add('clap-text', 'queries', Q)
    tpl = [tp.format(t) for t in TEMPLATE_TERMS for tp in v.templates]
    blobs.add('clap-text', 'templates', c.embed_text(tpl))
    tok = c.proc.tokenizer
    strings = [tp.format(t) for t in v.names for tp in v.templates] + [tp.format(q) for q in queries
                                                                       for tp in v.templates]
    tokens = {s: tok(s)['input_ids'] for s in dict.fromkeys(strings)}
    return v, Q, {
        'vocab': {'terms': v.names, 'categories': [v.cat_of[t] for t in v.names], 'templates': v.templates,
                  'blob': 'clap-text/vocab', 'bias': [round(float(b), 7) for b in v.mu_E],
                  'logitScaleStats': vocab.logit_scale(), 'logitScaleModel': float(c.logit_scale),
                  'unvalidated': list(vocab.UNVALIDATED)},
        'queries': {'texts': queries, 'blob': 'clap-text/queries',
                    'nearestCategory': v.nearest_category(Q), 'bias': [round(float(b), 7) for b in v.bias(Q)]},
        'templateRows': {'terms': TEMPLATE_TERMS, 'templates': v.templates, 'blob': 'clap-text/templates',
                         'note': 'raw c.embed_text rows (unit length) for each term x template, term-major'},
        'tokens': {'note': 'input_ids of tokenizer(text) without padding, for every template x vocabulary term and '
                           'template x query', 'ids': tokens},
    }


def audio_embeddings(blobs, rows, v, Q):
    """per clip: the CLAP windows describe / match / rank use (spans_for, <= 6 windows, repeatpad), their
    embeddings, the pooled embedding and its calibration against the vocabulary and the queries"""
    from earshot import audio, vocab
    out, pooled = {}, {}
    for r in rows:
        p = path_of(r)
        dur = audio.duration(p)
        spans = vocab.spans_for(0.0, max(dur, 0.01))
        W = vocab.embed_spans([(p, a, b) for a, b in spans])
        a = vocab.embed_file(p)
        cal = v.calibrate(a[None], Q)
        cid = r['id']
        pooled[cid] = a
        blobs.add('clap-audio-windows', cid, W)
        blobs.add('clap-audio', cid, a)
        blobs.add('calib-z-vocab', cid, cal['z_t'][0])
        blobs.add('calib-query', cid, np.stack([cal['cos_q'][0], cal['u_q'][0], cal['z_q'][0]]))
        if cid in UZ_CLIPS:
            blobs.add('calib-vocab-full', cid, np.stack([cal['cos_t'][0], cal['u_t'][0], cal['z_t'][0]]))
        mean = W.mean(0)
        out[cid] = {'duration': round(dur, 6), 'spans': [[round(x, 6), round(y, 6)] for x, y in spans],
                    'pooledCheck': float(a @ (mean / (np.linalg.norm(mean) + 1e-12))),
                    'top': [{'term': t, 'category': k, 'z': z, 'cosine': cs}
                            for t, k, z, cs in v.top_terms(a, k=8)]}
    log(f'  clap audio: {len(out)} clips')
    return out, pooled


def borderline(v, rows, ids, pooled):
    """for the given clips, the validated vocabulary terms whose z lies nearest each verdict threshold"""
    from earshot import vocab
    from earshot.match import SKIP_CATS
    out = {}
    for r in rows:
        if r['id'] not in ids:
            continue
        a = pooled[r['id']]
        z = v.calibrate(a[None])['z_t'][0]
        ok = [i for i, t in enumerate(v.names) if v.cat_of[t] not in vocab.UNVALIDATED + SKIP_CATS]
        picks, used = [], set()
        for th in THRESHOLDS:
            i = min((i for i in ok if i not in used), key=lambda k: abs(z[k] - th))
            used.add(i)
            picks.append({'term': v.names[i], 'z': round(float(z[i]), 4), 'threshold': th})
        out[r['id']] = picks
    return out


def clap_features(blobs, rows):
    """the CLAP feature extractor's input features (log-mel, (1, 1001, 64) per window) for a few windows"""
    from earshot import audio, vocab
    from earshot.models import clap
    c = clap.get()
    by_id = {r['id']: r for r in rows}
    out = {}
    for cid, k in FEATURE_CLIPS:
        p = path_of(by_id[cid])
        dur = audio.duration(p)
        a, b = vocab.spans_for(0.0, dur)[k]
        x = audio.load(p, mono=True)[int(round(a * audio.SR)):int(round(b * audio.SR))]
        seg = c._prep(x, 'repeatpad')
        inp = c.proc(audio=[seg], sampling_rate=audio.SR, return_tensors='np')
        feats = np.asarray(inp['input_features'], np.float32)
        blobs.add('clap-features', f'{cid}#{k}', feats[0])
        out[f'{cid}#{k}'] = {'clip': cid, 'window': k, 'span': [a, b], 'samples': int(len(seg)),
                             'shape': list(feats.shape[1:]),
                             'isLonger': np.asarray(inp.get('is_longer', [[False]])).reshape(-1).tolist()}
    return out


def ast_outputs(blobs, rows):
    """AST: per-window logits (527) as probs() windows them, the reduced probabilities, fbank input for a few clips
    and one 16 kHz resample"""
    import torch
    from earshot import audio
    from earshot.models import ast
    t = ast.get()
    by_id = {r['id']: r for r in rows}
    out = {'labels': t.labels, 'precision': t.precision, 'clips': {}}
    for cid in AST_CLIPS:
        p = path_of(by_id[cid])
        x = audio.load(p, mono=True)
        y = audio.resample(audio.to_mono(np.asarray(x, np.float32)), audio.SR, 16000)
        n = int(ast.WIN_S * 16000)
        starts = [0] if len(y) <= n else list(range(0, len(y) - n + 1, n // 2)) + (
            [len(y) - n] if (len(y) - n) % (n // 2) else [])
        logits, valid = [], []
        for s in starts:
            seg = y if len(y) <= n else y[s:s + n]
            seg = np.pad(seg, (0, max(0, 1600 - len(seg))))
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                inp = t.fe([seg], sampling_rate=16000, return_tensors='pt')
            with torch.inference_mode():
                logits.append(t.model(**inp).logits[0].float().numpy())
            valid.append(int((len(seg) - 400) // 160 + 1))
            if cid in FBANK_CLIPS and s == 0:   # frames are computed one by one, so leading frames suffice
                fb = inp['input_values'][0].numpy()
                keep = min(len(fb), valid[0] + 16, FBANK_FRAMES)
                blobs.add('ast-fbank', cid, fb[:keep], totalFrames=int(fb.shape[0]), validFrames=valid[0],
                          frames=[0, keep])
        L = np.stack(logits)
        blobs.add('ast-logits', cid, L)
        probs = t.probs_file(p)
        blobs.add('ast-probs', cid, probs)
        if cid == FBANK_CLIPS[0]:
            blobs.add('ast-resample-16k', cid, y)
        out['clips'][cid] = {'windowStarts16k': starts, 'validFrames': valid,
                             'maxSigmoidCheck': float(np.max(np.abs(1 / (1 + np.exp(-L)).max(0) - probs))),
                             'top': t.top(probs, 5)}
    log(f'  ast: {len(out["clips"])} clips')
    return out
