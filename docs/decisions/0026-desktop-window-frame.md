<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0026 — The desktop apps draw their own window frame

Date: 2026-11-23
Status: accepted (issue #32); amends ADR 0019

## Context

The desktop apps (ADR 0019, 0024) showed the system title bar above the
server's web UI, so the window looked like a browser in a box (#32). A custom
frame has two problems the issue names:

- **The page is the server's.** The window shows the web UI of the user's own
  server, of whatever version it runs (ADR 0022). A frame drawn by that page,
  or injected into it, would depend on the server's version and layout, and
  every page, including the bundled server screen, would have to make room
  for it.
- **Permissions.** Moving, maximizing and closing the window are Tauri
  commands. Granting them to the server's origin would let any page of a
  saved server move or close the window.

## Decision

- **Two webviews in one window** (Windows and macOS; Linux when it is built):
  - **frame**, a small bundled page (`apps/tauri/src/frame.html`) across the
    top: the icon, the name, and on Windows the minimize, maximize/restore and
    close buttons. It is 32 px high on Windows and 28 px on macOS.
  - **content**, below it, the webview that was the whole window before: the
    server screen and the server's web UI, with the bridge, the navigation
    rules and the download handler of ADR 0019 unchanged.
  - The shell sizes both when the window changes size or scale. Neither page
    knows the other is there, so the web UI and the server screen need no
    change and work with every server version.
- **Only the frame may move, resize or close the window.** The capability
  `frame` grants `core:window:allow-start-dragging`, `allow-minimize`,
  `allow-toggle-maximize` (and Tauri's internal double-click variant) and
  `allow-close` to the `frame` webview alone, for local pages only, plus
  `core:webview:allow-set-webview-focus`: a click on the bar gives the frame
  the keyboard, and the frame hands it straight back to the page, so typing
  and shortcuts keep working. Saved
  servers' pages get the bridge in the `content` webview only, as before.
  `scripts/test-app.js` checks both.
- **Windows:** no system title bar. The shell turns decorations off after the
  webviews exist, so Tauri's resize borders work on every edge and corner.
  The whole bar, icon and name included, is a drag region (`"deep"`);
  double-clicking it maximizes and restores. The
  maximize button turns into restore when the window is maximized.
- **macOS:** the native traffic lights stay (`titleBarStyle: Overlay`,
  `hiddenTitle`), over the frame's left end; the frame draws no buttons there.
- **The frame follows the window, not its own focus.** The shell tells the
  frame when the window gains or loses focus (the name dims) and when it is
  maximized, because the frame's own focus events only say whether the frame
  or the page below it has the keyboard.
- **Look:** the purple of the sidebar (`--side`, the same in the web UI and
  the server screen); the system colours in high-contrast mode. Button names
  ("Minimize", "Restore"…) come from `strings.js`, in the system language.
- iOS and Android keep a single webview: they have no window frame.
- **Linux** is not built yet. Before it is, the frame needs the same work as
  Windows there (decorations off, its own buttons); as the code stands a Linux
  build would show the system title bar above the frame.

## Consequences

- **Lost on Windows 11:** the Snap Layouts popup when hovering the maximize
  button, because Windows sees a page there, not a maximize button. Win+Z
  should show the same layouts, and dragging to a screen edge should still
  snap, since the bar moves the window with Windows' own drag (neither tried
  yet). Right-clicking the bar shows nothing (the frame blocks the webview's
  own menu); Alt+Space opens the system menu.
- The frame buttons are reachable by mouse and touch. From the keyboard the
  system shortcuts do the same (Alt+F4, Win+arrow keys, Alt+Space).
- Child webviews need Tauri's `unstable` feature (`Window::add_child`). A
  Tauri update may change that API; the build, not the user, finds out.
- Tried on Windows 11 at 100% scale, with the mouse: dragging the bar,
  resizing from the right and top edges, double-click, the three buttons,
  Win+Down, Alt+Space, the dimmed name when another window is active, and the
  native question dialog. A server page calling the window commands is
  refused. Not tried: other display scales, and macOS, which CI builds.
