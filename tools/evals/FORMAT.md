# Golden-set format

Labellers fill this in from week 1. A reel is one JSON file, or one block of rows in a spreadsheet exported as CSV. The eval runner scores a breakdown's cut list against these labels.

Times are **integer frame numbers** at that reel's frame rate. Do not write seconds, and do not write `29.97`. A rate is two integers: `30/1`, `25/1`, or `30000/1001` for NTSC 29.97. The pair is exact.

A span (`slots`, `overlays`) is half-open: `startFrame` inclusive, `endFrame` exclusive. `endFrame` may equal `durationFrames`. A cut, beat, or transition is one frame and must sit in `[0, durationFrames)`.

The three files in `golden/sample/` are synthetic. They are not real reels.

## JSON

One file per reel, named `<reelId>.json`.

| Field | Meaning |
| --- | --- |
| `reelId` | Lowercase id, hyphens allowed. Matches the file name. |
| `synthetic` | `true` for made-up samples. Real labels use `false`. |
| `note` | What the reel is. Samples say they are synthetic. |
| `source.label` | Short name of the footage. |
| `source.uri` | Optional path or URL the labeller used. |
| `source.durationFrames` | Length of the reel in frames. Positive integer. |
| `source.width`, `source.height` | Optional pixel size. |
| `frameRate.numerator`, `frameRate.denominator` | Positive integers. Not a float. |
| `cuts` | Cut frames, strictly increasing. |
| `beats` | `{ frame, kind }` with kind `downbeat`, `beat`, or `onset`. |
| `slots` | `{ id, startFrame, endFrame, intent }`. Intent is free text (`hook`, `demonstration`, …). |
| `overlays` | `{ id, text, startFrame, endFrame, position }`. `position.x` and `position.y` are 0–1 from the top left. `width` and `height` are optional, also 0–1. |
| `transitions` | `{ atFrame, kind }` with kind `cut`, `dissolve`, `wipe`, `fade`, or `other`. |
| `audio.type` | `speech`, `music`, `silence`, `mixed`, or `ambience`. |
| `languages` | BCP-47-style tags. v1 uses `en`, `hi`, `es`, `pt-BR`. At least one. No duplicates. |

`schema/golden.schema.json` is the JSON Schema export of the zod schema. Regenerate it with:

```sh
pnpm --filter @taalcut/evals run schema -- --out schema/golden.schema.json
```

Cross-field rules (strictly increasing cuts, spans inside the reel) are checked by the zod schema. The JSON Schema file records the field shapes.

## CSV

`golden/sample/sheet.csv` is the same three reels in one sheet. The first row is the header. `record_type` is one of `reel`, `cut`, `beat`, `slot`, `overlay`, `transition`. A `reel` row must come before the rows that belong to it. Languages use `|`, so `hi|en`. Quote a cell that contains a comma or a quote.

Convert a sheet to one JSON file per reel:

```sh
pnpm --filter @taalcut/evals csv -- --in golden/sample/sheet.csv --out /tmp/reels
```

Run that from anywhere; paths are relative to the current working directory. `pnpm --filter` runs with `tools/evals` as the current directory, so the paths above are relative to `tools/evals/`.

## Cut accuracy

A predicted cut matches a true cut when they are at most **2 frames** apart. Matching is one-to-one. Pairs are taken greedily: smallest distance, then the earlier true frame, then the earlier predicted frame.

For each reel, and again as a micro aggregate over every cut:

- precision = matched / predicted cuts, or 1 when there are no predictions
- recall = matched / true cuts, or 1 when there are no true cuts
- F1 = 0 when precision and recall are both 0, otherwise `2PR / (P + R)`
- both lists empty: precision, recall, and F1 are 1
- within-2 share = recall (1 when the reel has no true cuts)
- a reel is at the bar when that share is at least 0.90

The headline number is the share of reels at the bar, not the micro F1.

```sh
pnpm --filter @taalcut/evals run eval -- --golden golden/sample --predictions predictions/stub --out report.md
```

That writes `report.md` and `report.json` next to it. The process exits 0 when the files were written, including when F1 is low. It exits 1 when a golden reel has no prediction file, or a file does not match the schema. The message names the reel and the path.

## Real breakdown

`predict:breakdown -- --golden <dir> --out <dir> [--verdicts <dir>] [--steps <dir>]` runs `@taalcut/templates`' breakdown (P2-T4) on each reel and resolves its disputed cuts with the reel's recorded verdicts, or by the rule without any. Probing, normalising, scene scores and loudness are the real media and vision steps; the second cut method's frame embeddings (12×12 thumbnails) and the beat finder (a silence-gated click finder) are stand-ins until those models are bundled. `--steps` also writes the cut list after each step (`both`: cuts both methods found; `proposals`: those plus every dispute; `resolved`), so each can be scored with `eval`. `fixtures:breakdown` makes four synthetic reels whose cuts are known to the frame (VideoToolbox H.264 with a 120 BPM click track).

## Stub breakdown

`predictions/stub/` is not a model. For each true cut at index `i` (counting from 0):

- if the reel has at least four true cuts and `i` is 1, emit `frame + 3` (a miss)
- otherwise, if `i` is odd, emit `frame + 2` (still inside the tolerance)
- otherwise emit the true frame

Then it appends the lowest frame that is more than 2 frames from every true cut and every emitted cut. Rebuild the files with:

```sh
pnpm --filter @taalcut/evals stub -- --golden golden/sample --out predictions/stub
```
