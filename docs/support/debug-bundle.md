# A debug bundle

A debug bundle is a compressed note of what Taalcut was doing, so a person can see a failure without your clips. How the dialog fits a stuck task is in [Troubleshooting](troubleshooting.md). The short answers are in the [FAQ](faq.md).

## How to make one

1. Open **Send feedback**. **Commands** in the sidebar, or ⌘K, then **Send feedback…**. **Report this** on an error opens the same dialog, with that error named at the top.
2. Write what you did and what happened. If you press **Send** with nothing written, the dialog asks you to write a few words first. The dialog asks: **What happened, or what would you change?**
3. Turn on **Attach a debug bundle**. The line under it is: **Logs and the agent’s recent steps, so the team can see what went wrong.**
4. Leave **Include what I typed and Taalcut’s replies** off unless the words in the chat are part of the problem. Off, the bundle keeps only how long each message was.

The preview lists what would be included. Nothing is written until you send or save. The line under the list is: **Paths, keys and passwords are replaced; what you typed stays out unless you include it.**

There is no Send feedback item in the Mac menu bar in this build.

## How to send one

Press **Send**. That send is its own yes. Crash reports can stay off. You do not turn them on by sending feedback.

Taalcut posts the note, and the bundle if you attached one, to the address baked into this build. When it works, the dialog says **Sent. Thank you.**

**Send** does nothing useful in two cases:

- **Local only is on. Save the bundle and send it yourself.** **Send** is disabled. **Save bundle…** still works. Local only is Settings → Privacy → **Keep everything on this Mac**.
- This build has no address to send to. Saving still works. The dialog shows the cause. The spec name for that failure is `desktop.feedback_unavailable`. The window does not show that code as a title.

If the check below refuses the bundle, nothing is posted and the dialog shows the cause.

## How to save one

**Save bundle…** is on the dialog when **Attach a debug bundle** is on, and also when Local only is on.

It asks where to put the file. The panel starts in Downloads, with the name below. Cancel and nothing is written. When it saves, the dialog says **Saved as** and the file name.

The file is readable only by your Mac account. Send that file yourself if **Send** cannot. A saved bundle was checked the same way as a sent one.

## What is inside

One gzip file. The preview names each part in the dialog:

| In the dialog | What it is |
| --- | --- |
| This Mac and the app’s version | Version, channel, macOS, chip, memory, and related hardware notes |
| Logs | Recent lines from the app, and the last output from its helper processes |
| Traces | Recent agent runs: names, timing, tokens, cost, and error codes. Not the prompt |
| The agent’s recent runs | Those runs’ event logs, with text removed unless you included chat |
| Requests to models | Sizes, tokens, cost, and outcome for recent model requests. Not the prompts |
| Background jobs | Recent jobs: kind, state, and an error code. Not the job’s payload |
| Installed models and tools | Name, version, and state. Not the path they were installed to |
| Settings | Local only, crash reports, usage sharing, the project cap, onboarding, standing consents, and the model tier. Not keys |
| Crash recovery | The latest recovery note, without the developer detail |

The default window is the last 24 hours, and the last 10 agent runs. A run the app no longer has is left out.

## What the check strips or refuses

Taalcut replaces paths, keys, and passwords in its own sections before the check. The check does not trust that. It reads every section again. If anything below is still there, it refuses the bundle. Nothing is saved and nothing is sent. The spec name is `desktop.debug_bundle_unsafe`. The dialog shows the cause, not the secret that matched.

It refuses:

- A value from the Mac keychain (the raw value, the same value in base64, or the same value inside a web address), when that value is at least 8 characters
- A shape that looks like an API key or a login token
- A path in your home folder, a path written with `~/`, or anything under `/Volumes`
- A path that names a video, photo, or audio file
- Picture or sound bytes hidden in the text (JPEG, PNG, GIF, WebP, HEIC, MP4, MOV, and the other formats the check knows)
- A `data:` link
- A base64 run of 1,024 characters or more
- A section whose type is not plain text or JSON

Chat text stays out unless **Include what I typed and Taalcut’s replies** is on. Paths are still replaced when that switch is on. Do not paste a key into the note at the top. That note is scrubbed, and the check still runs on the bundle.

## The file name and the size

The name is `Taalcut-debug-<year>-<month>-<day>-<hour><minute>.json.gz`. The clock is UTC, so the time can differ from the clock on the Mac. Example shape: `Taalcut-debug-2026-10-14-1530.json.gz`.

The JSON is kept to 20 MB before it is compressed. If the logs would pass that, the oldest log lines are dropped first, and a note in the log section says how many were dropped.

## Each send is its own consent

Attaching a bundle and pressing **Send** is the yes for that one note. It does not turn on crash reports, and it does not turn on usage counts. The next send asks again, because you open the dialog again and press **Send** again. Saving a file does not send it.
