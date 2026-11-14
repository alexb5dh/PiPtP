# PiP the Player (PiPtP)

A Chrome extension that moves a site's whole video player into a Picture-in-Picture window, **with its controls and
subtitles**.

https://github.com/user-attachments/assets/830b3571-d79d-41aa-b8c9-67036f60baf0

## Features

- **Subtitles in PiP** - styling, language and timing exactly as on the page.
- **The player's own controls** - the seek bar, volume, and subtitle and quality menus keep working in the PiP window.
- **Keyboard** - the site's shortcuts work in the PiP window. Fallback keys for sites without them: `Space`/`K` play/pause, `←`/`→` seek 5 s, `↑`/`↓` volume, `M` mute.
- **Mouse wheel** - volume, unless the site uses the wheel itself. Scrollable menus keep scrolling.
- **Drag the video to move the window** - like Chrome's own PiP. Controls and subtitles still get their clicks.
- **Seek zones** - hovering the video shows zones on its left and right; a click there seeks 10 s back or forward. They hide after a short time with no mouse movement.
- Activated by `Alt+P` by default, configurable in Chrome keyboard shortcuts.
- **Optional: replace site PiP buttons** - a site's own PiP button opens this window instead of Chrome's native PiP.
- **Optional: pause on exit** - closing the PiP window pauses the video.

Options are checkboxes in the extension icon's right-click menu.

## Layout

Players that adapt their layout fill the window. Fixed-size players keep their controls at the on-page size while the
video grows; their top and center buttons move to the video's edges and center.

## Installation

The extension isn't published for now, but can be loaded unpacked:

1. Get the code: clone this repository, or download it as a ZIP and unpack.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder with `manifest.json`.
4. Optional: pin the extension to the toolbar (right click → pin).

After updating the code, click the reload button on the extension's card.

## Limitations

- Players in frames embedded from other sites fall back to Chrome's native PIP.

- A player that sizes itself to the browser window rather than to its own container may look off.
