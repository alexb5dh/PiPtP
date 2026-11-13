# PiP the Player (PiPtP)

A Chrome extension that moves a site's whole video player into a Picture-in-Picture window, **with its controls and
subtitles**. Chrome's built-in PiP shows only the bare video.

![The player in a PiP window, with subtitles, controls and a seek zone](docs/seek-zone.jpg)

## Features

- **Subtitles in PiP** - styling, language and timing exactly as on the page.
- **The player's own controls** - the seek bar, volume, and subtitle and quality menus keep working in the PiP window.
- **No site-specific code** - the player is found from its `<video>` element and the page's styles are copied.
Players that adapt their layout fill the window. Fixed-size players keep their controls at the on-page size while the
video grows; their top and center buttons move to the video's edges and center.
- **Keyboard** - the site's shortcuts work in the PiP window. Fallback keys for sites without them: `Space`/`K`
play/pause, `←`/`→` seek 5 s, `↑`/`↓` volume, `M` mute.
- **Drag the video to move the window** - like Chrome's own PiP. Controls and subtitles still get their clicks.
- **Seek zones** - hovering the video shows zones on its left and right 30%; a click there seeks 10 s back or forward.
The zones hide after 5 s without mouse movement.
- **Optional: replace site PiP buttons** - a site's own PiP button opens this window instead of Chrome's native PiP.
- **Ad blockers respected** - parts of the player hidden by an ad blocker stay hidden in the PiP window.

## Installation

The extension isn't published yet; load it unpacked:

1. Get the code: clone this repository, or download it as a ZIP and unpack it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder with `manifest.json`.
4. Optional: pin the extension to the toolbar (puzzle icon → pin).

After updating the code, click the reload button on the extension's card. Open tabs don't need a reload unless the
"Replace site PiP buttons" option is on.

### Shortcut

The suggested shortcut is `Alt+P`. Chrome doesn't assign it if another extension already uses it; in that case, set it at
`chrome://extensions/shortcuts` ("Activate the extension").

## Usage

- Press `Alt+P` or click the toolbar icon on a page with a video to open the PiP window; press it again to close it.
Closing the window returns the player to the page.
- **Replace site PiP buttons**: right-click the toolbar icon and check the option, then reload open tabs.

## Limitations

- **Players in frames embedded from other sites** fall back to Chrome's native PiP, without controls and subtitles:
browsers allow a Document PiP window only from the top-level page.
- **Chrome's own PiP entry points** (the video's right-click menu, the media controls panel, automatic PiP on tab switch)
can't be redirected; use the shortcut, or the site's PiP button with the option on.
- A player that sizes itself to the browser window rather than to its own container may look off.

## Project layout

| File            | Role                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `manifest.json` | Extension manifest (Manifest V3).                                                                  |
| `background.js` | Shortcut/toolbar handling, the site-button option, moving the window on drag.                      |
| `pip.js`        | Finds the player, opens the PiP window, moves the player there, copies styles, chooses the layout. |
| `pip-ui.js`     | PiP window extras: dragging the window, seek zones.                                                |
| `main.js`       | Runs in the page's own JS: correct click positions for players shrunk in the PiP window.           |
| `override.js`   | Runs in the page's own JS when the option is on: redirects the site's PiP calls.                   |
| `toggle.js`     | Opens or closes the PiP window after the scripts are injected.                                     |
