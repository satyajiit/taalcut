# @taalcut/gate-demo

The headless twin of the Phase 1 gate demo. It composes the real packages the
way the desktop app will and runs the demo end to end:

> Add my Desktop/Trip folder and tell me what's in the first video.

Then three follow-ups, each looking at another frame of that video: one in
the same conversation, one after a restart, and one after the consent is
revoked (`GATE_DEMO_FOLLOW_UPS`).

It runs twice: on scripted model clients, and on a recorded model session
(real `@taalcut/models` clients replaying `fixtures/gate-demo.cassette.json`).
The desktop smoke test (P1-I1) uses the same recorded session.

## What it proves

`test/gate-demo.test.ts` sends that message through the chat service and checks:

- **The tools are real.** `library.addSource` runs as a command on core's bus.
  `library.listFiles` reads the folder, and `media.probe` runs FFmpeg's ffprobe
  on a video the test makes. `vision.describeFrame` extracts a real frame and
  sends it to a cloud model (scripted, or replayed).
- **Approvals work.** `library.addSource` is a write, so it runs without asking
  at the default autonomy level. The frame upload pauses the run with core's
  consent card: the file, the provider, Allow once / Always allow / Don't send.
  "Always allow" lets it go ahead and stores the consent in the library's
  settings, so the follow-ups upload their frames without a card (each logs an
  approval from the standing consent). Revoked (`consentsService`, what
  `appContract.consents` serves), the next upload asks again; Allow once
  answers it and stores nothing. Each follow-up's prompt starts with the
  conversation so far: the earlier asks, their tool results (fenced) and
  answers.
- **The chat gets a name.** After the first exchange the agent's client
  writes the chat's title (`GATE_DEMO_TITLE`, a request without tools, asked
  as the router), and it stays across restarts.
- **The chat streams core's events.** `agent.runStarted` through
  `agent.runFinished`, reasoning included, and the stored history replays to
  the same transcript.
- **The trace is complete.** Every model and tool span has tokens, cost and
  latency. The trace rebuilt from the run log matches what the agent wrote to
  the library's trace store as the run went, which is what the developer trace
  viewer reads (`traces.get`, `traces.runs`).
- **Storage is real.** One library database file holds everything:
  - the command audit log, committed with the Source row in one transaction;
  - the agent's run log and its trace;
  - one CloudCall row per model call (8 for the agent and 1 for vision on the
    first ask, 4 and 1 on each follow-up, and 1 for the chat's title);
  - settings and conversations.
- **It survives restarts.** After the database is closed and reopened, the
  conversation, the consent and the source are all still there, and the second
  follow-up doesn't ask. Undo removes the source, and after another restart redo
  puts back the same one.

It lives here, not in `packages/agent`, because the agent may not import
library, media or vision (`.dependency-cruiser.cjs`). Only a composition root
may.

## Run it

```sh
pnpm --filter @taalcut/gate-demo test
```

It needs FFmpeg. In development the media package finds it (or set
`TAALCUT_FFMPEG_DIR`); without FFmpeg the suite is skipped with a warning. The
network is off for the whole run (`test/offline.ts`).

## The recorded model session

`createRecordedGateModels(GATE_DEMO_FIXTURES, { home })` (exported from
`@taalcut/gate-demo`) returns what `composeGateDemo` takes as `models`: an
agent client on `anthropic/claude-sonnet-5-5` and a vision client on
`anthropic/claude-haiku-5-5`, both real `@taalcut/models` clients whose `fetch`
answers from the cassette. pi-ai builds every request and parses every recorded
stream, and each call gets its CloudCall row. Nothing leaves the process.

- **It replays anywhere.** The model only ever sees canonical values: paths
  under `home` become `/Users/demo/…`, and ids become `00…01`, `00…02` in order
  of appearance (`src/canonical.ts`). Ids are numbered only from text no cut
  reaches: an id seen only where the agent cut a text short (an earlier tool
  call in a conversation's history) gets a `C…` stand-in by its place there,
  so whether a cut kept, split or dropped an id never renumbers the others.
  Replies are mapped back to this run's paths and ids. Pass the home folder
  the demo runs in.
- **Matching ignores the prompt text** (system and messages), so a SOUL.md edit
  or a tool result that differs by machine (file times, codec, the frame's
  bytes) doesn't break it. The model, its settings and the tools offered must
  still match, so a changed flow fails with a "re-record" answer rather than
  replaying the wrong turn. Which ask a call serves counts too: each request
  carries a `taalcut_ask` field for matching (the ask in the run's own user
  message, which comes after the conversation's earlier turns; for a vision
  call, the ask before it), taken off before it goes upstream. So each ask replays its own turns, also in a fresh process after a
  restart. After a run, `cassette.misses()` and `cassette.unused()` show drift.
- **The same catalogue on both sides** (LRN1-FIX). Tool search and a skill's
  route rank over the whole catalogue, so the demo (`test/compose*.ts`) and the
  desktop's agent process (`agent-loop.ts`) must offer the agent the same tools,
  and each session must have been recorded with them, or other tools get loaded
  and the recorded requests stop matching. Each session keeps the catalogue it
  was recorded with beside its cassette, `fixtures/<session>.catalogue.txt`
  (module, tool, a hash of what the model sees; `src/catalogue.ts`), written by
  whatever records it. The demo's test holds its composition to the gate demo's
  (`test/catalogue.test.ts`); the desktop's holds the agent to both
  (`apps/desktop/test/agent-catalogue.test.ts`), naming any tool added, dropped
  or changed, and how to re-record.
- **Re-record** the gate demo with `TAALCUT_RECORD=1 pnpm --filter
  @taalcut/gate-demo test`, which writes its catalogue too. The make flow is
  recorded in the app (`MAKE_FLOW_SESSION.rerecord`): after a test build of
  apps/desktop, `TAALCUT_RECORD=1 TAALCUT_RECORD_SESSION=make-flow playwright
  test --project=make e2e/make-flow.e2e.ts`; the agent process writes its
  catalogue. Its stand-in answers by skill (`src/make-flow-script.ts`); after
  the brief's export, "Send 3 comments to Taalcut" is one Editor step that
  lists the comments, edits a commented line of text and answers each
  (`src/make-flow-comments.ts`, EDT1-CMT). The editor's docked change
  (`EDIT_CHAT_SESSION`, EDT1-CTX) is recorded the same way in its own journey,
  `TAALCUT_RECORD=1 TAALCUT_RECORD_SESSION=edit-chat playwright test
  --project=make e2e/make-flow-edit-chat.e2e.ts`: the make flow's part replays
  from its own cassette, and only the docked turn is written.
  By default the recording is made against `createStandInProvider()`, an
  in-process stand-in that speaks Anthropic's streaming format and answers the
  script in `src/script.ts`: no key, no network, no cost. To record a real
  model, pass `upstream: globalThis.fetch`, `credentials` with a key and
  `secrets: [key]`; the key is scrubbed from the fixture.
- **Refresh offline** (EAR1-I1) when tools are added or changed but no flow
  is: `pnpm --filter @taalcut/gate-demo refresh:catalogue` reports, and
  `-- --write --update=<name>` writes (`scripts/refresh-catalogue.ts`). With
  the network off and no model, the gate demo's offers come from its headless
  journey recorded again with the stored responses as its only upstream
  (`TAALCUT_RECORD_UPSTREAM=cassette`), the app's skill steps take their
  skill's list from the desktop's agent process (its
  `test/agent-catalogue.test.ts`, which holds each recorded step to it), and
  the cassette recorder recomputes the request hashes. Every response,
  interaction count and timestamp stays (`fixtures/catalogue-refresh.json`). It
  refuses, writing nothing, when a flow changed: re-record that session then.
- **Why Anthropic for vision**: pi-ai's Google adapter refuses a custom `fetch`,
  and every `@taalcut/models` call passes one (its HTTP meter), so Google
  models couldn't be called when this session was recorded. A `pnpm patch`
  fixes that now (models SPEC, "Google through our fetch"). Both models are
  still current in pi-ai 1.4.0 (UX3-AGT), so the cassettes replay unchanged.

The desktop smoke test (`apps/desktop/e2e/gate.e2e.ts`, P1-I1) runs the same
session in the real app: it launches the test build with a temporary `HOME`
holding `Desktop/Trip/beach.mov` and `TAALCUT_TEST_RECORDED_MODELS` set to
`GATE_DEMO_FIXTURES`, so the agent process builds its models with
`createRecordedGateModels(fixtures, { home })`. It types `GATE_DEMO_ASK` into
the chat, answers the consent card with Always allow and expects the frame
description. It sends the first follow-up in the same conversation, relaunches
the app and sends the second; neither asks. It revokes the consent through the
app contract and sends the third, which asks again. Then ⌘Z (focus outside the
composer) removes the folder, and it checks the first run in the trace viewer
(`pnpm --filter @taalcut/desktop e2e:gate`).

## `test/compose.ts` is the template

`composeGateDemo` is the wiring the desktop composition root copies:

- `createLibraryPorts(db)` provides the audit log (with its unit of work for
  command handlers), the run log (wrapped in `fromCoreEventLog` for the agent),
  the cloud-call log, the trace store, settings and conversations;
- the source commands are registered on `createCommandBus`;
- tools come from library, media (through a job runner) and vision;
- `createAgent` gets `createCommandDispatcher(bus)`, a consent store kept in
  Settings (`createSettingsConsentStore`) and `ports.traces`;
- `createChatService` sits on the agent and the library's conversations.

In the app, the job runner is the jobs process's, the model clients are
`@taalcut/models` clients with `ports.cloudCalls` as their call log, and the
chat service is exposed to the renderer over oRPC.
