# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""EAR1-B1's extra `earshot find` runs on the long parity clips F2 has no find run for (films 01 and 03-09), written
to find-runs.json beside this file in F2's cli format ({run id: {argv, exit, result}}). Build/dev time only, in
upstream's venv at the pinned commit, on the clips F2's build left in its work folder:

    ~/.cache/taalcut-ear1/venv/bin/python -I packages/audio/test/listen/fixtures/find-runs.py

It reuses F2's settings and in-process CLI runner (tools/earshot-parity/upstream/common.py: fp32, 4 threads, the
shared caches), so the models stay warm and the results are what F2's own find runs would be."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'tools', 'earshot-parity', 'upstream'))

from common import CLIPS, sha256_file, write_json  # noqa: E402
from common import run_cli  # noqa: E402

RUNS = [
    ('film-01', 'a deep cinematic impact hit', []),
    ('film-01', 'a kick drum hit', []),
    ('film-03', 'a person speaking', []),
    ('film-03', 'a fast air whoosh', []),
    ('film-04', 'a soft synth pad', ['--kind', 'texture']),
    ('film-04', 'a mouse click', []),
    ('film-05', 'a snare drum hit', []),
    ('film-05', 'a punchy impact hit', ['--top', '3']),
    ('film-06', 'a rising riser building tension', []),
    ('film-06', 'a soft UI pop', []),
    ('film-07', 'a drum loop', []),
    ('film-07', 'a deep cinematic impact hit', ['--kind', 'event']),
    ('film-08', 'a fast air whoosh', []),
    ('film-08', 'ambient room noise', []),
    ('film-09', 'a kick drum hit', []),
    ('film-09', 'a short swish', []),
]


def main():
    runs, clips = {}, {}
    for cid, query, extra in RUNS:
        wav = f'{cid}.wav'
        clips[cid] = sha256_file(os.path.join(CLIPS, wav))
        argv = ['find', wav, query, *extra]
        res, code = run_cli(argv)
        rid = f'{cid}::{query}' + (f"::{' '.join(extra)}" if extra else '')
        runs[rid] = {'argv': argv, 'exit': code, 'result': res}
        print(rid, code, [s['start'] for s in res.get('segments', [])[:3]], flush=True)
    write_json(os.path.join(HERE, 'find-runs.json'),
               {'upstream': 'ff41f0788ae56896fd59879ab03858d223c06a53', 'precision': 'fp32', 'clips': clips,
                'runs': runs})


if __name__ == '__main__':
    main()
