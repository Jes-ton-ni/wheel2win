# Spin The Wheel

A complete, modern, responsive, offline-capable **Spin the Wheel** application built with HTML5, CSS3, Canvas API, and vanilla JavaScript. No backend, no database, no external APIs, no build step.

## Features

- **Canvas wheel** with equal sections, vibrant colors, adaptive labels, fixed top pointer, and a professional center hub.
- **Manual positioning** by dragging with mouse/touch, a 0–360° slider, fine (±1°) and coarse (±15°) rotation buttons, and a Reset Position button. Manual positioning is completely independent of spinning.
- **Hold-to-charge hand button** using Pointer Events (mouse, touch) and keyboard (Space / Enter). Holding charges from 0–100%; the instant it hits 100% the special effect flashes and the meter restarts at 0% with no pause, repeating while still held. Releasing spins with the strength shown at that moment. Quick tap = minimum-strength spin. No strength slider and no click-to-spin shortcut.
- **Real-time strength indicator to the right of the button**: large percentage, horizontal animated power meter, power-level label with four colors, and increasing button glow. 100% triggers a special pulsing effect, then the meter loops back to 0%. The percentage freezes on release and resets to 0% immediately when the spin finishes, so the next charge always starts from 0% with no buffer.
- **Natural spin animation** driven by `requestAnimationFrame`, with cubic in/out easing, acceleration + deceleration, power-based rotation counts (2–20) and durations, and cancellation/state management.
- **Mathematical winner detection** derived from the actual final wheel rotation under the fixed pointer — never a random pick.
- **Winner modal** with confetti, power/rotation stats, Spin Again, Close, and a **Remove winner from wheel** action (the spin stays in history).
- **Entry management**: a multiline text field where each line is one entry — add or delete entries by editing lines. Also shuffle the list order, clear all, change individual colors (swatch row), randomize colors, and restore defaults. At least two entries are required to spin.
- **Spin history** with winner, timestamp, strength, and rotations; newest first; clearable; saved locally.
- **Settings**: sound effects toggle (synthesized Web Audio, no audio files), configurable charge duration (1–6 s), fullscreen mode, and Reset Wheel.
- **Persistence**: entries, settings, and history stored in `localStorage`.
- **High-DPI and resize aware** canvas rendering via `ResizeObserver` and `devicePixelRatio`.
- Responsive desktop/mobile layout: Wheel Entries beside the wheel, with Manual Position and Settings directly below; touch-friendly controls throughout.

## Project structure

```
spin-the-wheel/
├── index.html          # Markup and UI structure
├── css/
│   └── style.css       # All styling, animations, responsive rules
├── js/
│   ├── storage.js      # localStorage wrapper (JSON, safe failures)
│   ├── wheel.js        # Canvas rendering + rotation source of truth
│   ├── spin.js         # Power calculation + rAF animator
│   ├── controls.js     # Pointer/keyboard input handling
│   └── app.js          # State machine and application orchestration
└── README.md
```

Load order matters: `storage.js` → `wheel.js` → `spin.js` → `controls.js` → `app.js`.

## Run locally

Because the app uses plain scripts (no ES modules), it works by opening the file directly:

1. Download or clone the repository.
2. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).

For a local server (recommended for accurate storage/fullscreen behavior):

```powershell
# Python
python -m http.server 8000
# then browse to http://localhost:8000
```

```powershell
# Node.js (if installed)
npx serve .
```

## Deploy to GitHub Pages

1. Create a GitHub repository and push the project files (including the `index.html` at the repository root).
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose branch `main` (or `master`) and folder `/ (root)`, then save.
5. Wait a minute and visit `https://<username>.github.io/<repository-name>/`.

All paths are relative, so deployment in a repository subfolder works without changes.

## How it works

- The wheel's rotation is stored as a single number of degrees in `Wheel.rotation`. Drawing converts it to radians; winner detection uses `localAngle = normalize(sector/2 - rotation)`, then `floor(localAngle / sector)`.
- Manual dragging adds the shortest angular delta to the current rotation. Slider/buttons set it directly. None of these touch the animation.
- Charging uses `performance.now()` elapsed time divided by the configured charge duration. Release rounds the value (minimum 1%) and passes it to `Spin.calculate()`, which maps it to a rotation count and duration.
- The animator interpolates from the preserved starting angle to `start + rotations*360 + smallOffset` using cubic easing, then normalizes the final angle. The winner is computed from that final angle.
- Valid state transitions are enforced: `IDLE → MANUAL_POSITIONING → IDLE`, `IDLE → CHARGING → SPINNING → RESULT → IDLE`.

## Testing checklist

1. Drag the wheel with a mouse and with touch; confirm real-time rotation and no spin.
2. Use the slider, ±1°/±15° buttons, and Reset Position; confirm the angle readout matches.
3. Quick tap the hand button → weak spin; hold 1 s / 2 s / 3 s → progressively stronger spins; hold past 100% → meter stays at 100% with the special effect.
4. Verify releasing immediately still spins, and that spinning cannot be triggered or charged again while in progress.
5. Confirm the winner shown always equals the section under the top pointer.
6. Try 2, 5, 10, and 20 entries; add/edit/delete/clear entries; randomize colors; reset defaults.
7. Refresh the page and confirm entries, settings, and history persist.
8. Check desktop and mobile layouts, fullscreen mode, and the sound toggle.

All settings and data are stored only in your browser; clearing site data resets the app to its defaults.
