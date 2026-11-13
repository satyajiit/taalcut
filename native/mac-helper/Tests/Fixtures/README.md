<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Taalcut contributors -->

# Fixtures

`portrait-pd.jpg` is a public-domain photograph of Albert Einstein, scaled to 540×720.

- Page: https://commons.wikimedia.org/wiki/File:Albert_Einstein_Head.jpg
- File: https://upload.wikimedia.org/wikipedia/commons/d/d3/Albert_Einstein_Head.jpg

The original photograph is in the public domain. Track tests paint a few frames from this still. Those tests check the `track.shot` document shape. They do not require Vision to find a face.

`transnetv2-synthetic.json` is what the shipped TransNetV2 ONNX model (`transnetv2` component, onnxruntime on the CPU)
predicts for one synthetic window: frame t, row y, column x, channel c is `(t < 50 ? 30 : 170) + 5x + 3y + 60c + 2(t mod 5)`
mod 256, a hard cut between frames 49 and 50. `tools/components/transnetv2-coreml/fixture.py` writes it when the
`transnetv2-coreml` component is packed; `ShotsTests.swift` compares the helper's Core ML answer with it.
