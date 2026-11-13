# FAQ

This page is the beta set; cohort questions get added when they exist.

The other two pages are [Troubleshooting](troubleshooting.md) and [A debug bundle](debug-bundle.md).

## How do I install it and what happens the first time?

Download the disk image from the [releases page](https://github.com/satyajiit/taalcut/releases), open it and drag Taalcut into Applications. It is a Mac app for Apple silicon, on macOS 14 or later.

The first launch walks through these screens, in order:

1. **How should Taalcut think?** Pick a profile. You can change it later in Settings.
2. **Checking your Mac.** Taalcut picks models that fit this Mac and downloads them in the background.
3. **You’re trying an early version.** Only on an internal or alpha build. Both sharing switches start off.
4. **Where are your videos?** Add a folder, or connect a phone over Wi-Fi. No app on the phone.
5. **Bringing in your clips.** You can keep going while Taalcut sorts them.
6. **Make your first video.** Paste a reel you like, or say what you want.

## Where do my files stay?

A folder you add stays where it is. Taalcut reads it in place and does not copy or move those files.

Clips that arrive from a phone are copied to **Movies → Taalcut → Originals**.

A finished export is kept with Taalcut’s own data and listed in **Exports**. **Show in Finder** shows that file. **Save as…** copies it somewhere else. The save panel starts in Movies (the Mac’s Videos folder). Subtitle files that sit beside the export are copied too, when they exist.

Previews Taalcut makes for itself, such as thumbnails, can be rebuilt. They are not your originals.

Dropping a folder onto the empty Library does not add it. The note says **Use Add a folder instead.** That button opens Settings → Sources. The **Add a folder** button on that page does not open the folder panel in this build. Use **Add folder** in the Library toolbar. It is on the page even when the library is empty, and it opens the panel.

## What is Local only?

Settings → Privacy → **Keep everything on this Mac**. The switch is labelled **Local only**.

While it is on, nothing of yours leaves this Mac: no cloud models, no uploads, no reel links, no feedback, and no usage counts. Update checks still run, and still send the app’s version and a random ID made for this Mac (not linked to you or your files). Models that belong on this Mac can still download. Those downloads send nothing of yours.

Jobs that have a model on this Mac keep using it. The others stay off until you turn Local only off.

**Send crash reports** and **Share usage counts** are paused while Local only is on. Their switches stay where you left them.

This is separate from the profile named **On this Mac** (first run, and Settings → Models). That profile’s own line is “Every job uses the models on this Mac. Lower quality, and no AI voice or images.”

## How do I sign in?

Settings → Accounts.

**Continue with ChatGPT** is the sign-in on that page. You finish on chatgpt.com in the browser. Taalcut does not see your password. When you are signed in, the row says **Using ChatGPT plan** and offers **Manage usage**. **Sign out** is on the same row.

**Other subscriptions** are Claude, GitHub Copilot, and Grok. Each one shows a warning before the first sign-in. They are not the default.

**API keys** are on the same page. A key is kept encrypted with a key in the Mac’s keychain. Taalcut does not show it back to you.

**Settings → Accounts → Servers** (**Advanced: bring your own server**) takes Ollama or LM Studio, and no other server. Taalcut already runs models on this Mac. Either one is optional, and you do not need it.

## How do I bring clips in?

**From a folder on this Mac.** On the Library, **Add folder** opens the Mac’s folder panel. On first run the same panel is **Choose a folder…**. Taalcut then watches that folder. The files stay put.

On an empty Library, the large **Add a folder** button only opens Settings → Sources. Settings → Sources describes folders and phone import. In this build its **Add a folder** button does not open the panel. Use **Add folder** in the Library toolbar.

**From a phone, over Wi-Fi.** This works in this build. Library → **From your phone**, or **Connect your phone** on an empty Library or on first run. The Mac listens only while that page is open. Scan the QR code with the phone’s camera, type the six-digit PIN, and pick the clips. The PIN is not inside the QR code. If the camera will not scan, open the address on the phone and enter the setup code, then the PIN. No app on the phone.

On the phone, **Choose from Files (full quality)** or **Choose from Photos (quicker, may be a smaller copy)**. If an iPhone sends a smaller copy, the clip is marked **Smaller copy**. Send it again from the Files app. The phone page tells you how: Photos → select → Share → Save to Files → On My iPhone.

The phone and the Mac need the same Wi-Fi. A guest network often keeps them apart. The page stops after 10 quiet minutes. **Start again** listens once more.

**From a phone, over a cable.** First run on a Mac has a cable step (**Plug your phone in**), but cable import is still partial in this build. The Wi-Fi page and folders are the complete ways in. See [Phone over a cable](troubleshooting.md#phone-over-a-cable).

## What is Taalcut doing after the clips arrive?

It works through each clip on this Mac. In order, that is: read the file, prepare it, make thumbnails (and a smoother preview copy for video), find the shots, look at each shot, hear which language is spoken, write down speech when someone is talking, and find the beat on a music file. It then indexes the clip for search and writes a short description of each shot.

Descriptions stay on this Mac unless you have allowed uploads for vision and Local only is off.

A clip shows **Looking** while this runs, including while a step is waiting. **Couldn’t read** means that file failed. The original is untouched. **Offline** means the drive that holds it is not connected. **Waiting for its model to finish downloading** means a step is paused until that model is on the Mac. A skip has its own line, such as **No shots were found in this clip** or **Nobody speaks in this clip**. That clip is not marked **Couldn’t read**.

## An export failed. Where is the file, and what do I see?

Open **Export**, choose where it is going, and start it. Taalcut checks the result before it is saved. You can close the dialog. The work stays in **Exports**.

When it finishes, the dialog title is **Exported**. **Show in Finder** shows the file. **Save as…** copies it.

When it fails, the title is **The export didn’t finish**, with the cause and **Try again**. The dialog’s **Back to the choices** returns to the form. There is no finished file to reveal.

When the checks want a person, the title is **Needs a look before you post it**, with **Review**. That is not the same as a failed export.

**Export stopped** means it was cancelled.

## Will the app update itself?

A build with an update address checks in the background for a newer version of the channel baked into that build. The public beta uses the **beta** channel; earlier test builds used **internal** and **alpha**. A build with no update address does not check.

There is no update section on Settings → About, and no **Restart to update** button. A newer build that passes Taalcut’s checks is staged, and it installs the next time you quit Taalcut.

Nothing is published on the **beta** or **stable** channel yet, and there is no staged public rollout.

An internal or alpha build also shows the early-version screen on first launch. Other builds skip that screen.

## Are crash reports sent on their own?

No. **Send crash reports** is off until you turn it on. Settings → Privacy → **Help improve Taalcut**. The line under the switch says they start from the next launch, and that they are not your media.

Turning them off takes effect immediately. Turning them on waits until the next time you open Taalcut. Local only pauses them even if the switch is on. A build with no report address has nowhere to send them. The switch still shows in that build.

**Share usage counts** is a separate switch, also off until you turn it on. Counts and timings only: not your clips, words, or file names. If you were given an alpha code, it is six letters and numbers. It is optional.

Sending a note is separate again. Each send is its own yes, and it works while crash reports are off. See [A debug bundle](debug-bundle.md).

## How do I send a debug bundle?

**Commands** in the sidebar, or ⌘K, then **Send feedback…**. An error’s **Report this** opens the same dialog.

The Mac menu bar has no Help menu and no Send feedback item in this build. The spec calls it Help → Send feedback. The control that exists is **Send feedback…**.

Full steps, what is inside, and what Taalcut refuses to save or send: [A debug bundle](debug-bundle.md). If something is stuck, start with [Troubleshooting](troubleshooting.md).

## What language is the app in?

English is the supported language for this beta. **Automatic · English** in Settings → General → **Language**
uses English regardless of your Mac’s language.

Contributors can explicitly select Hindi, Spanish or Brazilian Portuguese there or on the welcome screen. Each
carries a **Draft translation** label: these translations are incomplete and have not been signed off by a native
speaker. Some text may remain in English or read oddly. Choose **Automatic · English** or **English** to return.
