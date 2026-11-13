# Moderated usability sessions

Machinery for eight moderated sessions. This directory holds the scripts, the consent drafts, and the scorer. It does not hold a session a participant attended. No session has been run.

The product owner runs the sessions (week 17). Summaries read JSON records. They do not invent times, outcomes, or findings.

## Recruiting

Recruit creators who are new to Taalcut. Two per language, eight in total.

| Language             | Code    | Sessions |
| -------------------- | ------- | -------- |
| English              | `en`    | 2        |
| Hindi                | `hi`    | 2        |
| Spanish              | `es`    | 2        |
| Brazilian Portuguese | `pt-BR` | 2        |

Do not recruit someone who has already used Taalcut. Do not mix languages in one session. The moderator reads `script.<language>.md`.

## Clean Mac

Use a new macOS user account. Nothing else is installed. Taalcut is not already on the machine. The participant installs it from the DMG during T1.

Have these ready, and do not open them for the participant:

- the DMG
- a phone, or a folder of footage, for T2
- a card with one reel link, for T4

## What the moderator records

One JSON file per session. The shape is `session.schema.json`, checked by `parseUsabilitySession` (after a schema change, regenerate it with `pnpm --filter @taalcut/evals run schema -- --kind usability --out usability/session.schema.json`). Write ISO-8601 datetimes with `Z` or a numeric offset, a calendar `date` as `YYYY-MM-DD`, and the English codes the schema requires (`success`, `assisted`, `failed`, `abandoned`, `high`, `medium`, `low`, and `en` / `hi` / `es` / `pt-BR`).

Record:

- language, date, moderator
- the Mac: chip and memory in gigabytes
- the participant's cohort code (six uppercase letters or digits, or `NONE` when they have none; the gate dashboard slices sessions by language only) and experience
- for each task T1 through T6, in that order: `startedAt`, `endedAt`, outcome, errors seen, and ease (integer 1 through 7)
- `timeToFirstVideoSeconds`, from T1's start to the end of the first export, or `null` when they never exported
- findings: severity, area, what happened, and evidence

`synthetic` is `false` for a real session. It is `true` only on generated fixtures. Do not file a guessed time, a guessed ease score, or a finding you did not see. If they never export, write `null` for time to first video, never `0` or the cap, and keep the session in the summary directory: it counts in the median (after every exporter), in task success and in the findings.

Screen and voice stay on the machine unless the participant agrees, on the card, that a copy may leave. See the consent form.

## Timing

Start the timer when the task is read, as the read-aloud line ends. Stop at the success criterion or at the cap, whichever comes first. Do not pause while they hesitate or ask for help you are not allowed to give.

| Outcome     | When                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| `success`   | Criterion met at or before the cap, without help beyond what that task allows           |
| `assisted`  | Criterion met only after help the script does not allow. Write what you did in `errors` |
| `failed`    | Cap reached, criterion not met, they were still trying                                  |
| `abandoned` | They stopped before the cap, criterion not met                                          |

Assisted is not success. The summary rate is success divided by sessions.

## What the moderator may and may not say

You may read the task again, word for word, and you may use the May line for that task (`tasks.md`). You may say that you cannot do the task for them.

You may not explain how Taalcut works, name a control the task does not let you point at, click, type, or choose for them, or tell them whether they are close. T4 does not allow an explanation of the product or of the link. The words to read are in the script. The ease question and the three open questions are read verbatim.

## Scripts and consent

`script.en.md` is the source of truth. `script.hi.md`, `script.es.md`, and `script.pt-BR.md` are full draft translations, including the ease question and the three open questions. Native-speaker sign-off is still required (H8). Do not treat them as reviewed.

`consent.en.md` and the Hindi, Spanish, and Brazilian Portuguese consent files are drafts for counsel (H6). They are not legal advice and they are not signed off. Do not tell a participant that counsel has approved them.

## Summary

After real records exist, from `tools/evals`:

```
tsx src/usability/cli.ts summary --sessions <dir> --out <dir>
```

That writes `summary.json`, `summary.md`, and `findings.md`. An empty directory writes null medians (shown as `no data`, not zero) and a findings file that says there are none. `findings.md` groups the same note into one draft for the product owner to file the same week. It does not assign a work-package id.

Median time to first video uses the middle value, or the average of the two middle values when the count is even. A language with no session is null.
