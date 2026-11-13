# SHORTS1: source-grounded publishing copy

`buildShortSocialMetadataPack(ShortSocialMetadataInput)` packages the accepted candidate's title, hook and
summary for existing `publishPack` cards. It makes no model or image-generation calls and invents no research,
chapters, trending keywords or hashtags. The caller supplies source-grounded model copy and optional creator
identity and source provenance. Source timestamps describe the source excerpt, not new video chapters.

The default YouTube CTA names a supplied creator/channel. A native related-video CTA requires explicit
confirmation that the native attachment exists. Instagram only promises the full video at the profile link if
the saved destination was confirmed and exactly matches this source URL. An old episode's link cannot be
advertised as the current source. A description URL is provenance; it is never described as clickable.

The UI accepts publishing copy with zero thumbnails, labels it ready for review, and never publishes as a
side effect of creation. Postiz runs through the existing external-tool path when the person asks.

Acceptance: `test/short-social-metadata.test.ts`, UI `test/publish-pack-card.test.tsx`.

Desktop finishing resolves a supplied, channel-matched or default kit before cloud palette inference. Source
metadata is the only source of inferred identity; file names and model guesses never become handles. Brand
creation, graphic placement and graphic acceptance run through the command bus and share the originating
agent turn. Graphics use the existing HyperFrames Designer gate, with a first-frame title and a two-second CTA
over the ending footage. Failed designs remain reviewable and have no alternate rendering path. Cached style
and graphic IDs prevent duplicate writes and repeated design calls when a run resumes. The inferred brand cache
uses project and source asset IDs, so selecting a new candidate keeps the creator's edited source kit.
The default ending says “Full video on YouTube” for a supplied YouTube source without promising a clickable
link. A very brief faithful excerpt shortens or omits its opening title so the two graphics never overlap.

Designer model calls include the project/run trace and check the current project budget before every call.
Acceptance: desktop `test/shorts-finishing.test.ts`, `test/agent-designer-context.test.ts`.

Foreground shorts model calls inherit the upload approval recorded for their exact active tool call, including
“Allow once”. They cannot add a module or cloud provider beyond that scope, and never save a standing consent.
Explicit model targets preserve the approved chain during fallback; Local only and cancellation still apply.
Declared uploads trigger consent even when the tool also writes an editable timeline. Background callers retain
the standing-consent requirement. Acceptance: agent `test/consent.test.ts`, models
`test/background-models.test.ts`, desktop `test/agent-tool-models.test.ts` and
`test/agent-designer-pictures.test.ts`.
