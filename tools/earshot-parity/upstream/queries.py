# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""The fixed query sets the parity fixtures run upstream with (match, rank, find, compare, ab).

Borderline match queries are not listed here: build.py picks, for a few clips, the vocabulary terms whose upstream z
lies nearest 2.0, 2.5 and 3.0 (the verdict thresholds) and records them in the match fixture."""

NOISE_ALTS = ['a dog barking', 'a car horn', 'rain on a window']
HINTS = ['upbeat electronic dance music', 'a person speaking']

# SFX clip id -> what the sound should match
SFX_QUERY = {
    'sfx-whoosh-fast-crisp': 'a fast air whoosh',
    'sfx-riser-snatch': 'a rising riser building tension',
    'sfx-pro-impact-short': 'a deep cinematic impact hit',
    'sfx-cut-hit-punch': 'a punchy impact hit',
    'sfx-click-double': 'a mouse click',
    'sfx-pop-0': 'a soft UI pop',
    'sfx-ui-pop-boop': 'a cartoon boop',
    'sfx-pro-notify-ding-2045': 'a bright notification chime',
    'sfx-swipe-flick': 'a quick swipe',
    'sfx-typing-key-thock': 'a single mechanical keyboard key press',
    'sfx-pro-typing-key-soft': 'a soft keyboard tap',
    'sfx-glitch-hit': 'a glitchy digital stutter',
    'sfx-pro-zip-up': 'a zipper being pulled',
    'sfx-fit-tick-domino': 'a soft quiet UI tick',
}

# (run name, clip id, queries, alts, start, end)
MATCH_FIXED = [
    ('genre', 'music-120-fmaj', ['upbeat electronic dance music', 'calm acoustic guitar'], ['a sad piano ballad'],
     None, None),
    ('mood', 'music-090-amin', ['sad and melancholic music', 'uplifting and hopeful music'], None, None, None),
    ('drums', 'music-140-cmin', ['a drum machine beat', 'a piano melody', 'heavy rain falling'], None, None, None),
    ('instrument', 'music-080-cmaj', ['a synthesizer pad', 'an electric guitar riff'], ['a choir singing'], None,
     None),
    ('voice', 'speech-01', ['a man speaking', 'a woman speaking', 'a crowd talking'], None, None, None),
    ('voice', 'speech-03', ['a woman speaking'], ['a man speaking', 'a synthesizer lead'], None, None),
    ('synth', 'speech-04', ['a synthesizer lead', 'a person humming'], None, None, None),
    ('silent', 'edge-near-silent', ['a fast air whoosh'], None, None, None),
    ('silent', 'edge-digital-silence', ['quiet room tone'], None, None, None),
    ('tone', 'edge-pure-tone', ['a pure sine wave test tone'], ['a whistle', 'a beep'], None, None),
    ('clipped', 'edge-clipped', ['a distorted drum loop'], ['a clean drum loop'], None, None),
    ('dc', 'edge-dc-offset', ['a soft synth pad'], None, None, None),
    ('short', 'edge-very-short', ['a short pop', 'a mouse click'], None, None, None),
    ('segment', 'edge-long-70s', ['heavy rain falling'], ['a fire crackling', 'applause'], 20.0, 35.0),
    ('segment', 'edge-long-70s', ['a person speaking'], None, 35.0, 50.0),
    ('whole', 'edge-long-70s', ['upbeat electronic dance music', 'heavy rain falling'], None, None, None),
    ('rain', 'texture-rain', ['heavy rain falling'], ['a fire crackling', 'applause'], None, None),
    ('room', 'texture-room-tone', ['quiet room tone', 'an air conditioner hum'], None, None, None),
    ('mix', 'mix-speech-over-music', ['a person speaking over music'], ['instrumental music'], None, None),
    ('film', 'film-00', ['a mouse click', 'a deep cinematic impact hit'], None, None, None),
]

RANK = [
    'a fast air whoosh', 'a single mechanical keyboard key press', 'a soft UI pop', 'a deep cinematic impact hit',
    'a bright notification chime', 'a rising riser building tension', 'a mouse click', 'a glitchy digital stutter',
]

# (clip, query, extra args)
FIND = [
    ('edge-long-70s', 'a kick drum hit', []),
    ('edge-long-70s', 'heavy rain falling', []),
    ('edge-long-70s', 'a person speaking', []),
    ('edge-long-70s', 'a deep cinematic impact hit', ['--kind', 'event']),
    ('edge-long-70s', 'a soft synth pad', ['--kind', 'texture']),
    ('film-00', 'a mouse click', []),
    ('film-00', 'a fast air whoosh', []),
    ('film-00', 'a deep cinematic impact hit', ['--top', '3']),
    ('film-02', 'a soft UI pop', []),
    ('texture-rain', 'a single water drop', []),
]

# (clip, refs)
COMPARE = [
    ('sfx-whoosh-fast-crisp', ['sfx-swipe-flick', 'sfx-riser-snatch', 'sfx-pro-zip-up', 'sfx-pro-impact-short']),
    ('sfx-click-double', ['sfx-pop-0', 'sfx-fit-tick-domino', 'sfx-typing-key-thock', 'sfx-pro-typing-key-soft',
                          'sfx-glitch-hit']),
    ('music-120-fmaj', ['music-080-cmaj', 'music-096-gmaj', 'music-124-bbmaj', 'music-150-amaj', 'music-170-fsmin']),
    ('speech-01', ['speech-02', 'speech-03', 'speech-04', 'speech-05', 'speech-06']),
    ('film-00', ['film-01', 'film-02', 'film-03']),
]

# (a, b, query, refs, extra args)
AB = [
    ('sfx-whoosh-fast-crisp', 'sfx-swipe-flick', 'a fast air whoosh', None, []),
    ('sfx-click-double', 'sfx-pro-typing-key-soft', 'a mouse click', None, []),
    ('sfx-pop-0', 'sfx-ui-pop-boop', 'a soft UI pop', None, []),
    ('sfx-pro-impact-short', 'sfx-cut-hit-punch', 'a deep cinematic impact hit', None, []),
    ('sfx-riser-snatch', 'sfx-whoosh-fast-crisp', 'a rising riser building tension', None, []),
    ('music-120-fmaj', 'music-124-bbmaj', 'upbeat electronic dance music', None, []),
    ('speech-01', 'speech-03', 'a man speaking', None, []),
    ('music-080-cmaj', 'music-170-fsmin', None, ['music-090-amin', 'music-100-emin', 'music-110-dmaj'], []),
    ('sfx-pro-notify-ding-2045', 'sfx-fit-tick-domino', 'a bright notification chime',
     ['sfx-pop-0', 'sfx-click-double'], []),
    ('edge-long-70s', 'texture-rain', 'heavy rain falling', None, ['--a-start', '20', '--a-end', '30']),
]

TIMELINE_CLIPS = ['edge-long-70s', 'mix-speech-over-music', 'speech-01', 'texture-rain']

# clip ids whose borderline terms are picked (nearest the verdict thresholds)
BORDERLINE = ['sfx-whoosh-fast-crisp', 'sfx-typing-key-thock', 'sfx-pro-notify-ding-2045', 'music-120-fmaj',
              'speech-01', 'texture-rain', 'film-00']


def all_queries():
    """every query text the fixtures embed (borderline terms are vocabulary terms, embedded with the vocabulary)"""
    out = list(NOISE_ALTS) + list(HINTS) + list(SFX_QUERY.values()) + list(RANK)
    for _, _, qs, alts, _, _ in MATCH_FIXED:
        out += qs + (alts or [])
    out += [q for _, q, _ in FIND]
    out += [q for _, _, q, _, _ in AB if q]
    seen, res = set(), []
    for q in out:
        if q not in seen:
            seen.add(q)
            res.append(q)
    return res
