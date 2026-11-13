# Troubleshooting

Short notes for what this build actually does. Questions that are not a fix are on the [FAQ](faq.md). How to attach or save logs is [A debug bundle](debug-bundle.md).

## A folder will not add

**Symptom.** **Add folder** does nothing useful, or the empty Library says a dropped folder was not taken.

**What the app is doing.** **Add folder** on the Library opens the Mac’s folder panel, then adds that folder as a watched source. The files stay where they are. Dropping a folder onto the empty Library is refused on purpose. Settings → Sources has an **Add a folder** button that does not open the panel in this build.

**What to try.**

- Use **Add folder** in the Library toolbar, or **Choose a folder…** on first run. The large **Add a folder** button on an empty Library only opens Settings → Sources.
- Pick a folder, not a single file.
- If the panel opens and you cancel it, nothing is added. That is not a failure.

**When to send a debug bundle.** The panel never opens, or it closes and the folder still does not appear, and a second try does the same. [Send feedback…](debug-bundle.md) and attach a bundle.

## macOS will not let Taalcut read a folder

**Symptom.** Adding a folder fails, and the message offers **Open Files and Folders**.

**What the app is doing.** Taalcut asked macOS to read that folder. macOS refused. Protected places such as Desktop, Documents, or Downloads can do this. Taalcut does not ask for the microphone, the camera, Photos, or Automation. The only usage text it declares is Local Network, and that is for the Wi-Fi page.

**What to try.**

- Use **Open Files and Folders**. That opens System Settings → Privacy & Security → Files and Folders. Allow Taalcut for that location, then add the folder again.
- Or pick a folder Taalcut is already allowed to read.

**When to send a debug bundle.** Files and Folders already allows Taalcut, and the same folder still fails. Attach a bundle. Do not paste the folder path into the note if it is under your home folder. Say the folder’s name.

## The phone will not connect over Wi-Fi

**Symptom.** The phone cannot open the page, the PIN fails, or the Mac says it is not listening.

**What the app is doing.** While Library → **From your phone** is open, Taalcut listens on the local network and shows a QR code, an address, a setup code, and a six-digit PIN. It stops after 10 quiet minutes, when you press **Stop listening**, when this Mac has no Wi-Fi or Ethernet address (the page says it isn’t on Wi-Fi), or when you open the same screen in another window (that window takes over, and this one says so). A VPN can block the phone. If Local Network is off for Taalcut, the page says the phone can still send, and that the check itself is what Local Network is for.

**What to try.**

- Keep the phone page open on the Mac until the clips say they have arrived.
- Use the same Wi-Fi. Leave guest networks.
- Type the PIN from the Mac. A photo of the QR code is not enough. The PIN is not in the code.
- If the camera will not scan, open the address in the phone’s browser and enter the setup code, then the PIN.
- **New code and PIN** if the old ones were copied wrong. The old ones stop working.
- Pause a VPN and try again.
- **This Mac isn’t on Wi-Fi**, **Taalcut couldn’t start listening**, or **Stopped after 10 quiet minutes**: use **Try again** or **Start again** on that page.
- **The drive Taalcut keeps imports on isn’t connected**: connect the disk that holds Movies → Taalcut → Originals, then start again.
- If macOS asks about Local Network, the text is that Taalcut checks it can be reached so the phone can send videos, and that phones can still send if you turn that off.

**When to send a debug bundle.** The Mac says it is listening, the phone is on the same Wi-Fi with no VPN, and a new code still cannot connect. Attach a bundle. Do not include the PIN in a screenshot you would not show a stranger. The PIN is a one-time code. A new one replaces it.

## The phone sent a smaller copy

**Symptom.** A clip is marked **Smaller copy**, on the phone page or in the Library.

**What the app is doing.** It accepted the file and flagged it. An iPhone often sends a smaller video when you pick it from Photos in the browser. The original is still on the phone.

**What to try.** Send that video again with **Choose from Files (full quality)**. If it is not in Files yet, the phone page’s guide is: Photos → select → Share → Save to Files → On My iPhone.

**When to send a debug bundle.** You sent it from Files and Taalcut still marks **Smaller copy**. Attach a bundle. Do not attach the video.

## A clip stays on Looking, or says Couldn’t read

**Symptom.** The tile says **Looking** for a long time, or **Couldn’t read**.

**What the app is doing.** **Looking** means the clip is still being read: prepared, previewed, shot by shot, with speech written down when someone talks, and indexed for search. **Couldn’t read** means that file was skipped. It may be damaged, or a format Taalcut does not know yet. The original is untouched. A line that says it is waiting for a model means that step is paused until the download finishes. **No shots were found in this clip**, **This clip has no sound**, and **Nobody speaks in this clip** are skips, not failures.

**What to try.**

- Leave Taalcut open. Model downloads run in the background. Settings → About lists installed parts.
- Free disk space if the Mac is low. The hardware check calls out less than 20 GB free.
- For **Couldn’t read**, open the Library filter for failed files. The line there is that Taalcut could not read them and the originals are untouched. Try one other copy of the same clip, from Files rather than a smaller phone copy.

**When to send a debug bundle.** One clip stays on **Looking** long after the others from the same folder have finished, or every file in a normal folder says **Couldn’t read**. Attach a bundle.

## A clip says Offline

**Symptom.** The tile says **Offline**.

**What the app is doing.** The catalog still has the clip. The disk that holds the file is not connected, or the file is no longer at the path Taalcut remembers. Phone copies live in Movies → Taalcut → Originals unless that folder was on another disk.

**What to try.** Connect the drive, or put the file back. Taalcut does not delete your original because a drive was unplugged.

**When to send a debug bundle.** The drive is connected, the file is where you left it, and the tile stays **Offline**. Attach a bundle. Name the disk. Do not paste a home-folder path.

## The export didn’t finish

**Symptom.** The dialog says **The export didn’t finish**, or **Needs a look before you post it**, or **Export stopped**.

**What the app is doing.** An export is rendered, then checked, then saved. You can close the dialog. It stays in **Exports**. **The export didn’t finish** means there is no file to reveal. The cause is on the dialog. **Needs a look before you post it** means the file was made and the checks want you to review it before you post. **Export stopped** means it was cancelled. A finished one says **Exported**, and **Show in Finder** shows it. **Save as…** copies it. The panel starts in Movies.

**What to try.**

- Read the cause on the dialog. **Try again**, or **Back to the choices**, and export again.
- For **Needs a look before you post it**, use **Review**. **Export again** after you change something. **Later** leaves it.
- **Couldn’t show it in Finder** means Taalcut has no delivered file for that export.

**When to send a debug bundle.** The same timeline fails again with the same cause, or **Try again** never leaves **The export didn’t finish**. Attach a bundle. Say the dialog’s cause in your own words. Do not attach the export.

## Send is off, or a cloud step will not run

**Symptom.** **Send** in Send feedback cannot be pressed, or a job says it is off while Local only is on.

**What the app is doing.** Local only blocks cloud models, uploads, reel links, feedback, and usage counts. The feedback dialog says **Local only is on. Save the bundle and send it yourself.** **Save bundle…** still works. Update checks and model downloads are still allowed.

**What to try.**

- To send from the app, turn **Local only** off under Settings → Privacy → **Keep everything on this Mac**. Then send again. Each send is its own yes.
- Or leave Local only on, use **Save bundle…**, and send the file yourself. See [A debug bundle](debug-bundle.md).
- If you wanted cloud models, Local only has to be off, and Settings → Accounts needs **Continue with ChatGPT**, another sign-in you already accepted, or an API key. The **Local only** profile is a different control. It keeps work on this Mac even before the privacy switch.

**When to send a debug bundle.** Local only is off, you are signed in or a key is saved, and the same cloud step still will not run. Attach a bundle. Do not repeat the key.

## Taalcut did not update

**Symptom.** You expected a new build and the app is unchanged. Settings → General → **About** shows the version, and **Updates** beside it shows the channel and the last check.

**What the app is doing.** A downloaded release checks in the background and downloads a newer build only after its own checks pass. That build installs when you restart Taalcut. A build made from source does not check.

**What to try.** Open Settings → General → **Updates** and press **Check now**. When an update is ready the same page offers **Restart now**. Then read the version on **About**.

**Not in this build.** A percentage rollout, and a button that restarts into the update.

**When to send a debug bundle.** You were told this build should update, you quit and reopened it, and the version never changes. Attach a bundle.

## Phone over a cable

**Not in this build.** Taalcut does not import from an iPhone or an Android phone over USB. There is no device list, no trust prompt, and no cable step to follow.

Use a folder (**Add folder** on the Library) or the Wi-Fi page (Library → **From your phone**). Both are described in the [FAQ](faq.md#how-do-i-bring-clips-in).

**When to send a debug bundle.** Do not send one because a cable did nothing. That path is absent. Send one only if folder import or the Wi-Fi page fails after the steps above.

## The app is not in my language

**Symptom.** You wanted Hindi, Spanish, Brazilian Portuguese, or another language. Everything is English.

**What the app is doing.** Taalcut supports English. Automatic language selection uses English even when your
Mac uses another language. Hindi, Spanish and Brazilian Portuguese are incomplete contributor drafts, available
only by explicit selection; some text may still appear in English.

**What to try.** Open Settings → General → **Language**. Choose a language marked **Draft translation** if you want
to review a contributor draft, or **Automatic · English** to return to the default. The welcome screen also
offers the four explicit choices. Switching does not require a restart.

**When to send a debug bundle.** Send one if an explicit language choice fails to save or the interface does not
switch. Include the selected language and the affected screen. Missing or awkward draft translations belong in a
translation contribution; the developer-only pseudo-locale is for layout checks, not a supported language.
