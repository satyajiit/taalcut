# The README’s images

Everything under `.github/media/` is made here, so it can be made again when the app or the story changes.

| Image                                                     | Made by                          | From                                                                                                      |
| --------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `banner.webp`, `story.webp`, `avartan.webp`, `kaatu.webp` | `render.mjs`                     | `slides.html` and `slides.css`, with stills of the demonstration footage, the logo kit and Kaatu’s sheets |
| `film.webp`                                               | `render.mjs`                     | `slides.html` and `film.css`, around the launch film’s own poster (`website/public/media/film/`)          |
| `screen-*.webp`                                           | `capture.mjs`, then `render.mjs` | The renderer’s development server and its sample data, framed by `slides.html`                            |
| `how-it-works.gif`                                        | HyperFrames, then `gif.mjs`      | `how-it-works/` (`index.html`, `loop.css`, `loop.js`)                                                     |
| `badges/*.svg`                                            | `badges.mjs`                     | The list at the top of that script                                                                        |

## Make them again

You need FFmpeg and `cwebp` on the PATH, Google Chrome, and the workspace installed (`pnpm install`). The loop’s
render fetches the pinned HyperFrames CLI through `npx` the first time.

```sh
# 1. Stills from the demonstration footage (into build/, which is not committed)
node design/readme/stills.mjs

# 2. The app's screens, from its development server
pnpm --filter @taalcut/renderer dev --host 127.0.0.1 --port 4186 --strictPort   # leave running
node design/readme/capture.mjs

# 3. The stills
node design/readme/render.mjs            # or: node design/readme/render.mjs banner story

# 4. The loop
(cd design/readme/how-it-works && npm run check && npm run render)
node design/readme/gif.mjs

# 5. The badges
node design/readme/badges.mjs
```

Open `slides.html` in a browser to work on the stills, and run `npm run dev` in `how-it-works/` to scrub the
loop. `HYPERFRAMES_NO_TELEMETRY=1` turns the CLI’s usage counters off.

## What the screens are

The screens are the real interface with sample data, in the light theme at 2×. `capture.mjs` changes three
things so the pictures match the shipped app and the footage:

- The sample library draws its thumbnails. Each drawing is replaced by a still of the demonstration footage,
  the same still for the same drawing.
- The sample data is set in Goa and the footage is from Vietnam, so “Goa” reads “Vietnam”.
- Rows that only a development build has (Traces, UI kit, the catalogue switcher) are hidden.

Every screen image says **Interface preview with sample media**, and the README says it again under them. Keep
that line: these are previews of the interface, not recordings of a run.

## Rules for new images

- Light theme, on paper (`#fbf8f2`) with ink (`#211a13`) and the app’s four accents. Rounded corners with a
  transparent cut, so an image also sits well on GitHub’s dark page.
- Footage and stills come only from the files [MEDIA-LICENSE.md](../../MEDIA-LICENSE.md) lists.
- The logo comes from [the kit](../logo/kit/README.md) and is never retyped. Kaatu comes from
  [its sheets](../mascot/README.md).
- Words on an image are ones the app or the website already says. A number on an image is one the repository
  can show.
- Keep a GIF under 4 MB (`gif.mjs` stops over that) and `.github/media/` under about 20 MB.
