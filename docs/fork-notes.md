# Fork notes

This fork (charlesscheuer/ardia, branch `charlie/aster-pip-no-url-bar`) carries four changes on top of upstream `main`. Each one is listed with the files it touches and how to undo it.

## 1. No down arrow next to Clear

`apps/browser/src/components/sidebar/ClearDivider.tsx`: the `arrow.down` symbol before the Clear label in the tabs sidebar is gone. The label, its tooltip and `closeAllTabs` behaviour are unchanged.

## 2. Concentric borders

One rule everywhere: a nested corner's radius is the outer radius minus the inset to it.

- Content card: `layout.cardInset` is 6 on every side (`apps/browser/src/lib/theme.ts`), matching `cardTop` and the top-tab layout's `TOP_CARD_INSET`, so the card's corners are concentric in both layouts. `layout.windowRadius` (16 = cardRadius 10 + cardInset 6) names the implied window corner.
- Sidebar peek panel: `PEEK_RADIUS` is 11 (`apps/browser/src/components/layout/dockMotion.ts`) — the window radius minus its 5 pt inset.
- Sidebar groups and live folders: rows inside a group now use `GROUP_ROW_RADIUS` (9.5 = `GROUP_RADIUS` 12 − border 0.5 − pad 2) instead of 10 or 8 (`apps/browser/src/components/sidebar/geometry.ts`, `TabRow.tsx`, `LiveFolderBlock.tsx`). Group headers already used the concentric `GROUP_HEADER_RADIUS`.

## 3. The URL bar never shows in the browser window

- `Settings.addressBar` gains a `"never"` value; it is the default, and `migrateSavedSettings` maps a saved `"toolbar"`/`"sidebar"` value to `"never"` unless the user explicitly chose it (Settings › Appearance still offers all three, and choosing one there is respected from then on).
- The window toolbar (`apps/browser/src/components/Toolbar.tsx`, also used by split panes and the auto-hide toolbar) does not render the URL field when the setting is `"never"`. Back, forward, reload and extensions stay.
- View › Show Address Bar in Sidebar now toggles between the sidebar and `"never"`.
- Addresses are opened and edited with ⌘L / ⌘T: the command bar still grows from the card anchor and edits the current tab, it just has no persistent field to grow from. Little Ardia keeps its own address display; it is a separate window kind.

## 4. Aster-style Picture in Picture

Ardia already had Dia-style PiP (floating window, ⌘-scroll/pinch zoom, throw, stash). This adds the three behaviours Aster (the Electron browser whose `main.cjs` and `gesture_bridge.mm` were supplied with the request) has that Ardia did not:

- **Float any video.** `-[ArdiaCoreWebView requestPictureInPicture:]` still tries the native video PiP first (playing video first, then largest). When the page refuses — `disablePictureInPicture`, custom players, no PiP support — it falls back to a Document Picture-in-Picture window holding the same video element, styled to fill the window; closing the window puts the element back where it was (`pagehide` restores it at a comment placeholder). Playback, position and session carry over because the element itself moves.
- **Scroll to move.** A precise (trackpad) scroll over the PiP window moves it, following the natural-scrolling direction, clamped to the screen's visible frame. Aster resets any expanded state on move; so does this. ⌘-scroll and pinch still zoom, and a horizontal swipe still stashes. Turn it off with `defaults write <bundle id> ACPictureInPictureScrollMove -bool NO`. The clamp math is `ardiacore_pip_zoom::Moved` in `ArdiaCorePiPZoom.h`, covered by `packages/ardiacore/tests/pip-zoom.test.cc`.
- **Smart magnify to expand.** A double-tap (smart magnify) over the PiP window expands it to 65% of the screen width (capped so height stays under 75% of the visible frame), centred, aspect preserved; a second double-tap restores the exact previous frame. Width math is `ardiacore_pip_zoom::ExpandedWidth`, also unit-tested.
- **Auto-float on tab switch** now triggers for any playing video, not only audible or capturing pages: `useAutoPictureInPicture` (`apps/browser/src/components/media/pip.ts`) also latches on a playing video session. The existing setting (Tabs › Automatic Picture in Picture) still gates it, and a window the user closed still does not reopen until the tab is shown and left again.

Not ported from Aster: its ±10 s buttons inside the PiP window (Ardia's PiP already seeks from its progress bar and its players skip ±15 s) and its right-click Float Video item (the hover card and Site Controls already toggle PiP; page context menus come from the engine).

## Verification

- `packages/ardiacore` C++ tests pass on this machine: `pip-zoom.test.cc` (including the new `Moved`/`ExpandedWidth` cases) and `pip-throw.test.cc`.
- The browser app typechecks (`tsc`) for the touched packages.
- The native PiP changes need a Mac build and a real trackpad pass before they can be called done: scroll-to-move feel, smart-magnify toggling, and the Document PiP fallback on a custom player (e.g. a site with `disablePictureInPicture`) are the three checks.
