# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

**Desktop (open directly — no server needed):**
```bash
open index.html
```

**Phone / remote device (requires HTTPS for microphone access):**
```bash
python3 server.py
```
Prints a local-network HTTPS URL (e.g. `https://192.168.x.x:4443`). On first run, generates `cert.pem` / `key.pem` via OpenSSL. The phone must accept the self-signed cert warning before the browser allows microphone access.

## Architecture

No build step, no framework, no dependencies. Three files:

- **`index.html`** — static structure only; no logic
- **`style.css`** — dark-theme layout; the vertical meter uses a fixed gradient on `.meter-track` with `#meter-bar` as a dark mask that slides from the top (shrinks to reveal the gradient as level rises)
- **`app.js`** — all runtime logic

### app.js key concepts

**Scale mapping (`dbToPos`):** Both the bar and the history chart use a piecewise-linear mapping defined by `SCALE_ANCHORS` (anchors at -60, -40, -20, -10, -6, -3, 0 dB). This makes the seven scale labels evenly spaced visually while the bar height and canvas Y-axis remain consistent with each other.

**Meter pipeline:** `getUserMedia` → `AudioContext` → `AnalyserNode` → `getFloatTimeDomainData` → RMS → `20 * log10(rms)` (dBFS). Runs in a `requestAnimationFrame` loop.

**History:** Sampled at 10 Hz (every 100 ms, gated with `performance.now()`), stored in a plain array capped at 300 entries (30 seconds). Drawn on a `<canvas>` using a filled area chart with the same gradient as the meter. Max-value dashed line is recomputed and redrawn each sample.
