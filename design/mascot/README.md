# Kaatu, Taalcut's mascot

Kaatu is a chubby young beaver. The name comes from काटना, "to cut": beavers cut, and Taalcut cuts your clips to the beat. Flat vector, no outlines, one soft shade per colour. Deep-amber fur (true marigold is kept for the collar and the primary button), a cream muzzle and a clean cream tummy oval, big buck teeth, a rose nose and cheeks, short arms down its sides with the paws at its hips, and the Avartan ring as a collar (teal, marigold, rose, violet, with gaps, in the logo's order). The rules for where and how Kaatu appears are in the design system.

v0.4 (2026-10-14) moved the paws. In v0.3 they were two dark-brown domes side by side mid-chest on the cream patch, and read as a bust. Now the arms hang down the sides, the paws are fur-coloured and rest at the hips, and nothing sits on the chest. The arms also let Kaatu wave, stretch, hold a snack and play peekaboo.

## Frames

Six 3×3 sheets, 54 frames, every one lined up on the same body, so the player can cut between any two:

| Sheet | Cells, left to right, top to bottom | What it is for |
| --- | --- | --- |
| `directions` | up-left, up, up-right, left, **centre**, right, down-left, down, down-right | Turning to the pointer |
| `blinks` | the same nine turns with the eyes shut | A blink wherever Kaatu looks (v0.3 snapped the head to centre to blink) |
| `glances` | eight small turns around a **drowsy** centre (half-shut eyes) | The in-betweens of a turn, the half-closed eyes of a blink, nodding off |
| `reactions` | content, heart, sparkle, surprised, nibble, bashful, sleepy, dizzy, delighted | Moods and the first pokes. The fifth cell is a thinking nibble: eyes up, teeth on the lower lip |
| `antics` | snack, chomp, chomp-along, yawn-start, yawn, curious, wave, wave-out, cheeky | Idle antics: a log eaten like a corn cob, a yawn and stretch, a wonder, a wave, a cheeky tongue |
| `tricks` | bop-left, bop-right, laugh, peekaboo, peek, starstruck, clapper, clap, wink | Poke reactions and the dance (to the beat, with music notes), "action!" with a clapperboard |

How they are played (which frames, how long, which body move) is in `packages/ui/src/brand/kaatu-acts.ts`.

## Files

| Path | What it is |
| --- | --- |
| `source/concept.png` | The approved concept still (v0.4): the character reference every sheet was drawn from |
| `source/<sheet>.png` | The eight drawn sheets (the app's six and the site's two), transparent background, about 1254 px square |
| `prompts/concept.txt` | The v0.3 concept prompt (drawn with the PO's flat-vector style reference, which is not stored here) |
| `prompts/concept-paws.txt` | The v0.4 redraw: the v0.3 concept with the paws moved |
| `prompts/description.txt` | The character description the sheet prompts use |
| `prompts/<sheet>.txt` | One prompt per sheet, adapted from page-mascot's DIRECTIONS and EXPRESSIONS prompts |
| `build.py` | Lines every frame up and writes the app's atlases |
| `packages/ui/src/brand/kaatu-<sheet>.webp` | The atlases the app ships (720×720, 240 px cells, 48 to 58 KB each) |
| `web-atlas.py` | `build.py`'s method at 480 px cells, over all eight sheets: the site's atlases |
| `website/public/kaatu/kaatu-<sheet>.webp` | The atlases taalcut.app ships (1440×1440, 480 px cells, 120 to 135 KB each), each with its prompt beside it in `<file>.json` |

## How they were drawn

With Codex's built-in image tool, `transparent_background: true`, one call per image: the concept from the v0.3 concept and `concept-paws.txt`, then `directions` from the concept, then the other five sheets, each from the directions sheet. `glances` and `antics` took a second draw: the first glances were full turns, not small ones, and the first snack hid its twig behind the paws. Drive Codex from a script with the prompt on stdin (`codex exec … --image=<ref> < prompt`): `-i` takes several values and swallows a prompt given after it.

## Rebuilding the atlases

```sh
python3 design/mascot/build.py               # writes packages/ui/src/brand/kaatu-*.webp
python3 design/mascot/build.py --check /tmp/kaatu   # also writes an onion-skin sheet per atlas
```

Needs Python 3 with Pillow, NumPy and SciPy. It cleans each cell (specks the image model leaves; shapes that carry on into a neighbouring cell), then registers every frame on the centre cell of `directions`: scaled so the collar's teal and violet end segments span the same width, moved so the seat lands on the reference seat, then slid a few pixels to where the lower body overlaps best. It prints, per frame, the scale against its sheet and that overlap; the 2026-10-14 set measured 96 to 100%, with nothing clipped. The output keeps the v0.3 framing (the seat at 74.6% down the cell, the drawing 59.6% of it tall), so `Kaatu`'s optical inset still holds. Each sheet must keep the body identical in all nine cells; redraw a sheet whose overlap drops much below 95%. When adding a sheet, add it to `SHEETS` in `build.py` and in `kaatu-frames.ts`, in the same order.

## The web sheets

taalcut.app shows Kaatu bigger than the app does, and in poses the app never needed, so the site has two more sheets and its own atlases.

| Sheet | Cells, left to right, top to bottom | What it is for |
| --- | --- | --- |
| `web-creator` | film, snip, headphones, point, thumbs-up, hold-reel, cheer, selfie, type | Kaatu making a video: filming, cutting a strip, listening, pointing the way, approving, holding up a reel, cheering |
| `web-story` | peek-left, peek-up, nap, carry-strip, jump, laptop, search, heart-hands, big-wave | Kaatu on the page: peeking round a reel or over a ledge, napping on a clip, carrying a strip, searching, waving hello |

Each cell is one pose, and the site names it: `<Kaatu pose="snip">` (`website/src/components/kaatu/kaatu-poses.ts` says which frame each pose holds and the short act it plays). They were drawn the way the app's sheets were, with Codex's image tool and `transparent_background: true`, from `prompts/web-creator.txt` and `prompts/web-story.txt`, with the directions sheet and the concept still attached. The props are flat shapes in the palette with no words, numbers or logos on them, and every paw and prop stays above the seat, so the body still lines up with the other six sheets.

## The site's atlases

```sh
pnpm --filter @taalcut/website kaatu                     # runs web-atlas.py, then embeds each atlas's prompt
python3 design/mascot/web-atlas.py --check /tmp/kaatu-web   # also writes an onion-skin sheet per atlas
```

`web-atlas.py` writes `website/public/kaatu/kaatu-<sheet>.webp`: all eight sheets, 3×3 at 480 px cells. The app's 240 px cells are sharp to about 120 px on screen; the site shows Kaatu up to 240 px on a 2x screen, so it needs twice the cell. The source cells are about 570 px, so 480 is still a downscale: nothing is ever upscaled. It registers every frame as `build.py` does, on the centre cell of `directions`. The web sheets are scaled by the width of the cream tummy oval instead of the collar, because their props (the teal scissors, the violet headphones and screen) share the collar's colours and confuse its read. The app's atlases are unchanged: the app still builds them with `build.py`.

`website/scripts/kaatu-atlas.mjs` runs the build (`KAATU_PYTHON` picks a Python with Pillow, NumPy and SciPy) and then records each atlas's provenance, the sheet's prompt quoted whole. When adding a web sheet, add it to `SHEETS` in `web-atlas.py`, to `WEB_SHEETS` and `SHEET_NAMES` in `kaatu-frames.ts` and to `KAATU_ATLASES` in `kaatu-atlas.mjs`, in the same order, and give it a layer in `kaatu.css`.
