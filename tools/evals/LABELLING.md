# What to label

The files in this package that say `synthetic: true` were generated. They prove the runners. They are not a gate result, and they are not a substitute for the set below. Gate numbers are claimed only after a person replaces them.

Put real files in the paths in the table. Keep `synthetic: false`. A reel, a query and a case id are lowercase words with hyphens (`beach-hook`, not `Beach Hook`).

| Set | How many | Where | Gate |
| --- | --- | --- | --- |
| Breakdown reels | 50 | `tools/evals/golden/<reelId>.json` | Criterion 3: cuts within 2 frames on at least 85% of reels |
| Search queries | 100, 25 each of `en`, `hi`, `es`, `pt-BR` | `tools/evals/labels/search/<library>.json` | Criterion 11: at least one relevant shot in the top 5, on at least 75% of queries, in each language |
| Casting cases | 3 libraries × 10 templates | `tools/evals/labels/casting/<library>/<caseId>.json` | Criterion 2: at least 60% of slots kept, and at least 60% of sequences kept |
| Render look | 10 timelines | `tools/evals/goldens/render/<id>/` | You approve the contact sheet. The timing check does not need a judgement |
| Intent ratings | 20 reels | the sheet from `intents`, filled, then `intents:score` | At least 80% of slots marked usable |

Sample libraries themselves (the footage and `libraries/<library>.json` manifests) are a separate product-owner task. Labels name an asset by its path in that manifest, plus an optional frame range, so a re-index does not invalidate them.

## Breakdown reels

One JSON file per reel, named `<reelId>.json`. The field rules are in [FORMAT.md](FORMAT.md). Times are integer frames at that reel's rate (`30/1`, `25/1`, `30000/1001`). Do not write seconds.

Mark every cut a person would make. A cut on a beat or a transition is still one frame. Slots are half-open: `startFrame` inclusive, `endFrame` exclusive.

A spreadsheet works too. Export CSV with the header in `golden/sample/sheet.csv` and run:

```sh
pnpm --filter @taalcut/evals csv -- --in sheet.csv --out golden
```

The three files in `golden/sample/` are synthetic. Leave them there. Add the 50 real reels beside that directory, in `golden/`, not inside `sample/`.

## Search

One JSON file per sample library, at `labels/search/<library>.json`. The file is an array of queries, not an object wrapped around them:

```json
[
  {
    "queryId": "beach-sunset",
    "language": "en",
    "library": "library-id",
    "text": "sunset on the beach",
    "relevant": [{ "asset": "clips/beach.mov", "range": { "startFrame": 12, "endFrame": 48 } }],
    "synthetic": false
  }
]
```

`queryId` is unique across every library. `text` is what a person would type, in that language. `relevant` is every shot that should satisfy the query, not only the best one. At least one. Omit `range` when the whole asset is the answer. A range is half-open frames at the asset's rate.

Write 25 queries in each of English (`en`), Hindi (`hi`), Spanish (`es`) and Brazilian Portuguese (`pt-BR`). Spread them across the three sample libraries. The same idea in two languages is two queries. The language code is `pt-BR`, not `pt`.

The bundled ffmpeg has no `drawtext` filter. The synthetic fixture therefore burns ASCII words in with a bitmap, so a machine can run the runner before real footage exists. Real labels use the real query text in the four languages. Do not copy the synthetic words into the 100-query set.

Optional `filters`: `orientation` (`landscape`, `portrait`, `square`), `minFrames`, `maxFrames`, `minQuality` (0 to 1), `capturedAfter`, `capturedBefore` (`YYYY-MM-DD`).

A predicted shot counts when it is the same asset and the two ranges overlap by at least half of the shorter one. The runner reports hit@5 (at least one relevant shot in the top five) and, beside it, the share of the top five that are relevant.

CSV, one row per relevant shot: `queryId,language,library,text,asset,startFrame,endFrame,synthetic`. Leave the frame cells empty when the whole asset is relevant.

## Casting

One JSON file per library and template, at `labels/casting/<library>/<caseId>.json`. `caseId` is unique across every library (a repeated template id will collide when the predictions are scored). Slot 0 is the hook: its `acceptable` list is every shot a person would keep as the opening.

```json
{
  "caseId": "vlog-day",
  "library": "library-id",
  "synthetic": false,
  "template": { "file": "templates/vlog-day.json" },
  "slots": [
    { "slotIndex": 0, "shotType": "wide", "acceptable": [{ "asset": "clips/arrival.mov", "range": { "startFrame": 0, "endFrame": 30 } }] }
  ],
  "order": {
    "groups": { "arrival": [{ "asset": "clips/arrival.mov" }], "beach": [{ "asset": "clips/beach.mov" }] },
    "rules": [{ "before": "arrival", "after": "beach" }]
  }
}
```

`acceptable` is every shot you would not swap away, not a single winner. `order` is null when any order of acceptable shots is fine. Otherwise `rules[].before` and `rules[].after` are group ids into `groups`, not shots. The earliest pick that matches any shot in the `before` group must sit in an earlier slot than the earliest pick that matches the `after` group. A case with no rules counts as a kept sequence.

For a story told from a brief instead of a template file, use `"template": { "brief": { "text": "...", "formatId": "vlog", "targetSeconds": 15 } }` and label the slots of that format's plan.

The runner's two numbers are the gate: the share of slots whose pick was acceptable (slots never swapped) and the share of sequences that satisfy every rule (sequences never reordered). Both need to be at least 60%.

## Render goldens

`goldens/render/<id>/timeline.json` is the timing plan. Do not hand-edit cuts to match a render that drifted. The check fails when any cut or in-point moves by one frame.

What needs a person is the look. Run `goldens:approve` (when the render adapter is wired) to write `hashes.json` and a contact sheet. Accept or reject that sheet. Caption and overlay frames in English, Hindi, Spanish and Portuguese are part of that look.

## Intent sheet

After an analyst run on the 20-reel sample:

```sh
pnpm --filter @taalcut/evals intents -- --golden golden --predictions predictions/analyst --out sheet.csv
```

Fill the empty `usable` column with `yes` or `no`. One row is one slot. Then:

```sh
pnpm --filter @taalcut/evals intents:score -- --sheet sheet.csv
```

The pass line is 80% `yes` overall. Leave no row blank.

## Still not a label

Device-lab footage for the nightly hour, and both self-hosted runners, are not labelling work. Until the hour of 4K footage is on the runner, the nightly script marks itself synthetic and does not open a gate claim.
