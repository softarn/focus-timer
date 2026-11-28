# Focus Timer

A simple Pomodoro timer with 25-minute focus and 5-minute break cycles by default.
Plain HTML, CSS and JavaScript — no build step, no dependencies, no network.

## Usage

Open `index.html` directly in a browser (double-click it or use `file://`).

- **Start / Pause** toggles the countdown. **Reset** returns to a fresh focus countdown at the configured duration.
- Select **Skip break** during a running or paused break to start the next focus session immediately.
- Press **Space** to start or pause, **R** to reset, or **S** to open settings.
- Press **?** or select **Keyboard shortcuts** to open the shortcut list. Press **Escape** or select **Close** to dismiss it.
- Open **Settings** to set **Focus minutes** and **Break minutes** to whole numbers from 1 to 90, then select **Save**. The browser remembers them when local storage is available. A focus or break already in progress keeps its remaining time.
- Set an optional **Daily goal** from 1 to 24 whole focus sessions in **Settings**. Leave the field blank to clear the goal. The browser remembers the saved goal when local storage is available.
- **Today** counts completed focus sessions and shows progress as **Today: 2 of 6** when you set a goal. The count resets at local midnight and is remembered across reloads when local storage is available. When a completed session first brings the count to the goal that day, the page shows **Goal reached — nice work**.
- When a phase ends, a soft chime plays and, if you allowed it, a notification appears.
  Notification permission is requested only when you first press Start; the timer works without it.
- Screen readers hear phase changes, settings confirmations and the daily goal message. The countdown updates silently.
- The browser tab title shows the remaining time and phase once you start, including while paused. It reads **Focus Timer** before you start and after you reset.
- Light and dark themes follow your system setting.

## Files

- `timer.js` – pure timer state machine (also usable from Node)
- `settings.js` – settings, daily count and goal storage helpers
- `app.js` – page, sound and notification wiring
- `index.html`, `style.css` – page and styles

## Tests

Requires Node.js 18+:

    node --test
