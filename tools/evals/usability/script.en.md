# Moderator script

English is the source of truth. Read the quoted lines to the participant. Do not add an explanation of the product.

## Before the session

- The participant is a creator who has not used Taalcut before.
- The Mac is a new macOS user account. Nothing else is installed. Taalcut is not already on the machine.
- You have the DMG, a phone or a folder of footage, and a card with one reel link.
- Consent is signed before you record. Screen and voice stay on this Mac unless the participant agrees, on the card, that a copy may leave.
- You are not grading the participant. You are watching the product.

## Timing

- Start the timer when the task is read. The clock starts as you finish the quoted line.
- Stop the timer when the success criterion is met, or when the cap is reached, whichever comes first.
- Do not pause the timer while they read, hesitate, or ask you something you are not allowed to answer.

## Outcomes

Record one outcome per task:

- **success.** The success criterion was met at or before the cap, and you did not help beyond what that task allows.
- **assisted.** The criterion was met only after help this script does not allow. Write what you did in `errors`. Assisted is not success.
- **failed.** The cap was reached and the criterion was not met. They were still trying.
- **abandoned.** They stopped the task before the cap, and the criterion was not met.

## What you may and may not say

You may read the task again, word for word. You may say that you cannot do the task for them. You may use the May line for that task.

You may not explain how Taalcut works, name a control the task does not let you point at, click, type, or choose for them, or tell them whether they are close.

## Ease question

After every task, read this verbatim. Do not rephrase it.

> On a scale of 1 to 7, where 1 is very hard and 7 is very easy, how easy was that task?

Record the integer they give. If they answer with a word, ask the question once more. Do not pick a number for them. If they still will not give an integer from 1 to 7, stop the session and do not file a score you invented.

## T1. Install from the DMG and open

- **Cap:** 10 minutes.
- **Read, then start the timer:** "Install Taalcut from this DMG and open it."
- **Success:** the app window is open.
- **May:** point at the DMG.
- **May not:** click for them.

Then read the ease question verbatim.

## T2. Onboarding until a library is imported

- **Cap:** 15 minutes.
- **Read, then start the timer:** "Go through onboarding until a library is imported. Use your phone, or this folder."
- **Success:** at least one clip is visible in the library.
- **May:** offer the phone or the folder you provide.
- **May not:** import the library for them.

Then read the ease question verbatim.

## T3. First video from a starter template

- **Cap:** 20 minutes.
- **Read, then start the timer:** "Make a first video from a starter template. Do not use a reference reel."
- **Success:** an export file exists.
- **May:** repeat that it is a starter template and not a reference reel.
- **May not:** choose the template or export for them.

Then read the ease question verbatim.

## T4. A video from a reel link

- **Cap:** 20 minutes.
- **Read, then start the timer:** "Make a video from the reel link on this card."
- **Success:** an export file exists.
- **May:** hand them the card with the reel link.
- **May not:** explain the product, or explain the link.

Then read the ease question verbatim.

## T5. Swap one clip and export

- **Cap:** 10 minutes.
- **Read, then start the timer:** "Swap one clip and export."
- **Success:** the new export uses the clip they chose.
- **May:** repeat that they should swap one clip and export.
- **May not:** choose the clip or export for them.

Then read the ease question verbatim.

## T6. Change the language and the caption style

- **Cap:** 10 minutes.
- **Read, then start the timer:** "Change the language and the caption style."
- **Success:** the UI language has changed and the captions use the style they picked.
- **May:** repeat that they should change the language and the caption style.
- **May not:** change the language or the caption style for them.

Then read the ease question verbatim.

## Open questions

At the end, read these three questions verbatim, one at a time. Write what they say. Do not turn a shrug into a finding they did not state.

1. "What was confusing?"
2. "What would you tell a friend?"
3. "What did you expect to happen that did not?"

## Time to first video

`timeToFirstVideoSeconds` is the number of seconds from T1's start, when T1 is read, to the end of the first export. That is the end of T3, or earlier if they exported sooner.

Stop that clock when the export file exists, not when they notice it later. If they never export, do not write 0 and do not guess. Leave the session out of the summary folder rather than invent a duration.

## Findings

Each finding is something you observed: a severity (`high`, `medium`, or `low`), the area of the product, what happened, and the evidence (what you saw or what they said). The same note, apart from case and extra spaces, is one finding. Do not file a finding you did not see.

## Record codes

Keep these codes in English in the JSON, even if you spoke another language: outcomes `success`, `assisted`, `failed`, `abandoned`; severities `high`, `medium`, `low`; language `en`, `hi`, `es`, or `pt-BR`. A real session has `synthetic` set to `false`.
