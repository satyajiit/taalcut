# Drag-to-Applications installer

The release DMG opens a 660 × 440 point Finder window with the Taalcut app at `(180, 240)` and a real
`/Applications` link at `(480, 240)`. Its artwork uses a light background so Finder's default dark labels stay
legible. `background.tiff` has 1x and 2x representations for Retina displays.

Regenerate the artwork on a Mac with:

```sh
swift apps/desktop/packaging/dmg/render.swift
```

This follows the existing Matterward Labs OpenAlly and UnfoldMyMac installation pattern. electron-builder
writes the Finder layout; Taalcut's distribution hooks sign, notarize and staple the app before making the
image, then sign, notarize and staple the DMG. A release check must mount the final image, verify the app
inside it and confirm that `Applications` is a link to `/Applications`.

Installer copy is English for the first beta. It is artwork, not a renderer catalogue string.
