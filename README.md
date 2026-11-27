# Focus Timer

A simple Pomodoro timer: 25-minute focus and 5-minute break cycles.
Plain HTML, CSS and JavaScript — no build step, no dependencies, no network.

## Usage

Open `index.html` directly in a browser (double-click it or use `file://`).

- **Start / Pause** toggles the countdown. **Reset** returns to a fresh 25:00 focus session.
- When a phase ends, a soft chime plays and, if you allowed it, a notification appears.
  Notification permission is requested only when you first press Start; the timer works without it.
- Phase changes are announced to screen readers; the per-second countdown is not.
- The browser tab title shows the remaining time.
- Light and dark themes follow your system setting.

## Files

- `timer.js` – pure timer state machine (also usable from Node)
- `app.js` – DOM, sound and notification wiring
- `index.html`, `style.css` – page and styles

## Tests

Requires Node.js 18+:

    node --test
