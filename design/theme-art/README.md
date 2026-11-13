# The day/night scene's art

The sun, the crescent moon and the star sparkles that play across the window when you flip the theme with the sidebar's toggle (nightfall and daybreak, `packages/ui/src/theme/theme-scene.ts`). They are drawn in Kaatu's flat vector style: simple rounded shapes, no outlines, flat fills with one soft shade, and Kaatu's face (dark-brown dot eyes with a catchlight, a thin smile, rose cheeks). The sun is marigold and gets its warm glow from a CSS gradient behind it; the moon is pale cream and gets its faint violet halo the same way, so neither glow is painted into the art. The rules for when the scene plays are in the design system ("Theme engine").

## Files

| Path | What it is |
| --- | --- |
| `source/sun.png` | The sun, with a face (two dot eyes, a small smile, rose cheeks), transparent background |
| `source/moon.png` | The crescent moon, dozing (closed eyes, a small smile), transparent background |
| `source/stars.png` | Four sparkles in a 2×2 grid; the scene uses the first three |
| `prompts/style.txt` | The style notes every subject prompt ends with |
| `prompts/*.txt` | The subjects. The faceless sun and moon and the moon with open eyes were drawn in a first pass, to choose between |
| `build.py` | Builds the WebP files the app ships into `packages/ui/src/theme/art/` |

The app ships `sun.webp` and `moon.webp` (256 px, about 11 KB and 8 KB) and `star-1.webp` to `star-3.webp` (96 px, about 2.5 KB each).

## Why these

With a face against without: the faceless sun read as a weather icon and the faceless moon's craters as a biscuit; the faces belong to the mascot's world. The dozing moon over the one with open eyes: the scene is the day going to sleep, and the mascot dozes after nightfall too. A cloud wisp was drawn and dropped: cream on the light canvas, it disappeared.

## Redrawing

Each image is one call to the Codex CLI's image tool with `transparent_background: true` and Kaatu's concept sheet (`design/mascot/source/concept.png`) as a style reference only, with the subject prompt followed by `prompts/style.txt`, verbatim:

```sh
codex exec -s workspace-write --skip-git-repo-check -C <a scratch folder> - < instruction.txt
```

Check every drawing on both canvases at the size the scene shows it (96 px sun, 88 px moon, 20 to 28 px stars) before keeping it, then replace the PNG in `source/` and run `python3 design/theme-art/build.py`.
