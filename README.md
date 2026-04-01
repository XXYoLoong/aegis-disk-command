# Aegis Disk Command

A local-first disk telemetry cockpit for Windows drives. It pairs a live Node scanning service with a cinematic React dashboard so you can watch every drive as if it were part of a control console instead of a flat file explorer.

## What It Does

- Monitors all mounted Windows filesystem drives in real time
- Tracks total, used, free, and pressure levels across the fleet
- Scans each drive in the background for top-level density, focus directories, and visible large files
- Highlights cleanup opportunities such as recycle bins, download depots, cache zones, sync-heavy folders, toolchain sprawl, and virtualization payloads
- Surfaces cross-drive duplication patterns and standardization guidance
- Presents everything in a dark operations-cockpit UI tuned for high-density situational awareness

## Design Direction

- Base tone: deep blue-black control-room surface
- Accent language: restrained cyan, low-saturation violet, and cool electric blue
- Layout model: central command panel with lighter sidecar intelligence modules
- Motion model: low-noise, pulse-based, system-style presence rather than consumer-grade flash

## Stack

- React 19
- TypeScript
- Vite
- Express 5
- `systeminformation`
- Windows PowerShell for directory analysis

## Project Structure

```text
disk-command-cockpit/
├─ server/
│  ├─ index.mjs
│  └─ scan-drive.ps1
├─ src/
│  ├─ lib/
│  ├─ App.tsx
│  ├─ index.css
│  ├─ main.tsx
│  └─ types.ts
├─ dist/
└─ package.json
```

## Run Locally

```bash
npm install
npm run dev
```

This starts:

- the local telemetry service at `http://127.0.0.1:5525`
- the Vite client at `http://127.0.0.1:5173`

For a production-style local run:

```bash
npm run build
npm run start
```

Then open:

```text
http://127.0.0.1:5525
```

## How Scanning Works

- Live filesystem capacity refresh: every 5 seconds
- Background deep drive analysis: queued and processed sequentially
- Drive scan outputs:
  - top-level directory and file footprint
  - one-level-deeper focus directory breakdown
  - visible large file artifacts
  - heuristic cleanup and standardization suggestions

This intentionally keeps the app responsive on large disks while still building richer analysis over time.

## Notes

- The project is local-first and does not upload disk contents anywhere
- The UI reads drive metadata and directory structure; it does not delete or move files
- npm cache for this workspace is configured to stay on `F:` via `.npmrc`

## Future Upgrades

- Delta scanning and persistent historical telemetry
- Drive-specific deep scan triggers with progress bars
- Treemap and sunburst views for large folder hierarchies
- Exportable cleanup reports
- Optional screenshot capture and scheduled reporting
