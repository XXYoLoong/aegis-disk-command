# Aegis Disk Command

[简体中文](./README.md)

[![Stars](https://img.shields.io/github/stars/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/stargazers)
[![Forks](https://img.shields.io/github/forks/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/network/members)
[![Issues](https://img.shields.io/github/issues/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/issues)
[![Last Commit](https://img.shields.io/github/last-commit/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/commits/main)
[![Platform](https://img.shields.io/badge/Platform-Windows_10%2B-0078D6?style=flat-square&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![React](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![AI](https://img.shields.io/badge/AI-DeepSeek-4D6BFE?style=flat-square)](https://api-docs.deepseek.com/)
[![Mode](https://img.shields.io/badge/Mode-Local--First-0B1220?style=flat-square)](#)

A local-first disk command cockpit for Windows. It combines live capacity telemetry, directory scanning, heuristic fallback logic, and optional DeepSeek-powered AI analysis so you can inspect every mounted drive like a control surface instead of a flat file explorer.

## Features

- Monitor all mounted Windows filesystem drives in real time
- Track total, used, free, and pressure levels across the fleet
- Scan top-level directories, focus directories, and visible large files in the background
- Detect recycle bins, cache zones, download depots, sync-heavy folders, toolchain sprawl, virtual disk payloads, and game libraries
- Use DeepSeek to generate smarter per-drive opportunities and cross-drive standardization suggestions when `DEEPSEEK_API_KEY` is available
- Automatically fall back to local heuristic analysis if AI is unavailable, times out, or returns invalid output
- Present everything in a dark command-center UI designed for high-density situational awareness

## How The Analysis Works

The current analysis layer is not just a few hardcoded frontend messages. It has two separate layers:

1. Collection layer  
   `server/scan-drive.ps1` reads top-level directories, focus directories, and notable files for each drive. `systeminformation` provides live storage, CPU, and memory telemetry.

2. Analysis layer  
   `server/index.mjs` always produces a local heuristic result first. If `DEEPSEEK_API_KEY` is present, it then calls DeepSeek's official `POST /chat/completions` API and asks for strict JSON output. The AI result is merged with the local fallback result.

That means:

- The app still works with no AI at all
- The analysis is no longer limited to fixed keyword rules when AI is enabled
- If the AI call fails, the dashboard automatically falls back to local rules instead of breaking

## AI Mode

AI mode is enabled automatically when `DEEPSEEK_API_KEY` is present in the environment. Optional environment variables:

```bash
DEEPSEEK_API_KEY=your_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_TIMEOUT_MS=12000
AI_ANALYSIS_ENABLED=true
```

Notes:

- `DEEPSEEK_MODEL` defaults to `deepseek-chat`
- `AI_ANALYSIS_ENABLED=false` forces the app back into heuristic-only mode
- AI mode sends trimmed path metadata, directory names, sizes, and fallback opportunity summaries to DeepSeek in order to generate structured recommendations

## Stack

- React 19
- TypeScript
- Vite
- Express 5
- `systeminformation`
- Windows PowerShell
- DeepSeek Chat Completions API (optional)

## Project Structure

```text
disk-command-cockpit/
  docs/
    step-by-step-log.md
  server/
    ai-analysis.mjs
    index.mjs
    scan-drive.ps1
  src/
    lib/
    App.tsx
    index.css
    main.tsx
    types.ts
  dist/
  package.json
```

## Run Locally

```bash
npm install
npm run dev
```

This starts:

- the local disk analysis service at `http://127.0.0.1:5525`
- the Vite dev server at `http://127.0.0.1:5173`

For a production-style local run:

```bash
npm run build
npm run start
```

Then open:

```text
http://127.0.0.1:5525
```

## Runtime Model

- Capacity telemetry refresh: every 5 seconds
- Deep scans: queued and processed sequentially
- After each drive scan:
  - local heuristic analysis is generated first
  - DeepSeek is called for structured JSON analysis when enabled
  - opportunities are merged and cross-drive standardization suggestions are refreshed
- If AI is unavailable, the local heuristic output remains active

## Notes

- The project is local-first and does not upload full file contents
- The UI reads drive metadata and directory structure only; it does not delete or move files
- When AI is enabled, trimmed path names, folder names, and storage summaries are sent to DeepSeek
- npm cache for this workspace is pinned to `F:` via `.npmrc`, not `C:`

## Roadmap

- Incremental scanning and persistent telemetry history
- Markdown / JSON report export
- Richer Treemap / Sunburst visualizations
- Per-drive progress feedback
- Configurable AI prompts and privacy trimming policies
