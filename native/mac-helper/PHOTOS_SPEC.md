# LIB2-P: selected Apple Photos originals

The signed helper has a dedicated `photos` service (protocol 2, service version 1), launched with confined staging
roots and a main run loop. It uses public PhotoKit APIs against the System Photo Library; it never traverses the
Photos library package and never changes or deletes an asset. PhotoKit calls the permission level `readWrite`
because there is no read-only authorization level. Taalcut implements reads and exports only.

| Method             | Input                                                                                                                            | Result                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `photos.status`    | `{}`                                                                                                                             | `authorization`: not_determined, denied, restricted, authorized, limited; no prompt |
| `photos.connect`   | `{}`                                                                                                                             | Explicit permission request, then authorization                                     |
| `photos.list`      | `cursor` offset, `limit` 1–500                                                                                                   | Original resource groups, separate Photos metadata, total, nullable nextCursor      |
| `photos.thumbnail` | assetId, new dest                                                                                                                | Original preview at most 256 px, nullable path; network always false                |
| `photos.export`    | selected assetId/resourceIndex/resourceType/originalFilename, new dest, operationId, allowNetwork, localOnly, optional byteLimit | path and measured bytesWritten                                                      |

Creation/modified dates, favorite and Photos location stay in `photosMetadata`; they never replace embedded file
metadata. The `.photo`, `.video`, `.audio`, `.alternatePhoto` and `.pairedVideo` resources are originals; full-size
and adjustment resource families are excluded. Live Photo grouping and required members are retained. Filenames
are preserved in the resource records; destination names are chosen by the app, inside the helper's allow-root.
Sizes stay null: there is no private KVC file-size lookup. The caller maps Photos ids to opaque draft ids and
revalidates the saved resource tuple on export. Reloading routes only calls status/list; only Connect can prompt.

Desktop `createPhotosImportAdapter` joins the helper to durable import sessions. A selectable capture bundles its
required original resources; preflight rejects missing Live Photo members, changed resource tuples, unsupported
formats, permission loss and Local only/cloud conflicts. `photos_imports` retains separate Photos metadata and
per-resource upload/asset receipts. Capture locks prevent concurrent writes to the same receipt. Retry reuses
completed members and the existing import sink's journals; it exports only unfinished originals. Source provenance
uses the `photos` channel and never invents a phone identity. The shared space coordinator reserves a conservative
budget for each unknown-sized resource and the helper enforces that limit before writing each chunk.
Recovery checks staged and journalled files against measured byte counts and confined paths; stale markers restart
only that resource under a new upload id. Completion markers must still identify a known library asset. Removing
private staging markers never deletes an original named by a destination journal.

Selection previews use `app://media/import-preview/<opaque item id>.jpg`. The protocol resolves the durable draft
locator on the main side and lazily calls `photos.thumbnail`; it cannot call Connect or allow network. GET requests
share in-flight work, cancelled viewers release their reads, and HEAD only inspects cached previews. Temporary JPEGs
are validated and atomically renamed inside the app cache; arbitrary paths, stale selections and symlink escapes
are rejected. Native Photos ids never become URLs.

`PHAssetResourceManager.requestData` streams chunks directly to an exclusively created staging file. The file
is flushed and closed before successful return. Each chunk is checked against the caller's coordinated byte
reservation; exhausted reservations and write errors cancel the PhotoKit request. Actual cumulative byte events
(`photos` / `bytes`, operationId, bytesWritten, terminal) are limited to four per second, with completion immediate.
There is no invented total, percentage or ETA. Cancellation waits for PhotoKit completion and removes partial files;
already committed imports belong to the session engine and are retained. Retrying starts the unfinished resource
from its beginning. A changed/missing resource requires reselection. All list/export operations fail after permission
loss without reopening the permission dialog.

Network is disabled for every thumbnail. Export accepts an opt-in only for the explicitly selected original and
rejects it in Local only mode. Cloud-only originals without opt-in report `photos.cloud_required`. Photos edits are
not imported. No synchronization, backup, edited rendition, deletion, stitching or reframing is implemented here.

## Evidence and release gate

`PhotosTests.swift` covers explicit permission routing, invalid pages, confined/non-overwriting paths, original
resource filtering, chunk integrity, byte reservations, cancellation and cloud-required failure. Desktop
`apple-photos.test.ts` covers lazy connection, unknown totals, policy, event isolation, failures and cancellation.
`photos-import.test.ts` exercises SQLite session restoration, opaque selections, separate metadata/provenance,
partial Live Photo retry, Only new, changed resources, missing companions and Local only refusal.
Packaging tests cover the app and helper entitlement and localized permission reason.

The packaged permission/export gate remains a hardware check with an owner-prepared System Photo Library. Record
app identity/build hash, macOS version, authorization state and fixture ids; exercise local photo/video, Live Photo,
edited asset (original expected), cloud refusal, selected download, Local only refusal, revoked access, cancellation,
disk exhaustion and relaunch. No owner library has been opened by automated verification, and no device combination
is advertised as verified from unit tests alone.

Public API references: [network behavior](https://developer.apple.com/documentation/photos/phassetresourcerequestoptions/isnetworkaccessallowed),
[chunked resource requests](<https://developer.apple.com/documentation/photos/phassetresourcemanager/requestdata(for:options:datareceivedhandler:completionhandler:)>).
