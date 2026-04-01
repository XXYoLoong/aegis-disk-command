# Aegis Disk Command

[中文 README](./README.md)

[![Stars](https://img.shields.io/github/stars/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/stargazers)
[![Forks](https://img.shields.io/github/forks/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/network/members)
[![Issues](https://img.shields.io/github/issues/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/issues)
[![Windows](https://img.shields.io/badge/Windows-Only-0b6cff?style=flat-square)](https://www.microsoft.com/windows)
[![React](https://img.shields.io/badge/React-19-0ea5e9?style=flat-square)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-7c3aed?style=flat-square)](https://vite.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-Express-1f7a43?style=flat-square)](https://nodejs.org/)
[![PowerShell](https://img.shields.io/badge/PowerShell-Scanner-2f6fed?style=flat-square)](https://learn.microsoft.com/powershell/)
[![DeepSeek](https://img.shields.io/badge/AI-DeepSeek-2563eb?style=flat-square)](https://api-docs.deepseek.com/)

A local, real-time disk command cockpit for Windows. Instead of generating a one-off static report, it behaves like a continuously running operations surface:

- monitors all drives in real time
- streams scan progress with live counters and current paths
- surfaces hot directories, large files, cache opportunities, and cross-drive duplication
- adds per-drive AI interpretation plus cross-drive governance suggestions
- supports post-analysis AI chat so you can keep asking follow-up questions
- splits the experience into focused work views instead of forcing everything into one giant dashboard

![Aegis Disk Command Overview](./docs/screenshots/overview.png)

## Why It Is Faster Now

The old bottleneck was not just “PowerShell is slow”. The bigger problem was repeated subtree I/O:

- one recursive pass for top-level sizing
- another recursive pass for focused directories
- more repeated reads for extra detail
- AI analysis blocking the next drive from scanning

The new architecture speeds this up in two ways:

1. Scan pipeline optimization

- `server/FastScanner.cs` uses Win32 `FindFirstFileExW` with `FIND_FIRST_EX_LARGE_FETCH`
- the scanner walks each subtree only once
- it aggregates all needed outputs during that same traversal:
  - top-level sizes
  - focused child entries
  - notable large files
  - live progress counters

2. Analysis pipeline optimization

- `server/index.mjs` separates the scan queue from the AI queue
- as soon as one drive finishes scanning, the next drive can start immediately
- AI analysis runs asynchronously in the background and no longer blocks scan throughput

On the current machine, the default full scan of `C:` was measured at about `37.4 seconds`, down from the previously observed `~7 minutes`.

## UI Structure

The UI is now organized as a multi-surface workbench:

- `Overview`
  - system-level capacity pressure, cross-drive opportunities, duplicates, normalization guidance
- `Drive Detail`
  - top-level hot spots, focused directories, notable files
- `Scan Flow`
  - live progress, current root, current path, roots completed, files visited, directories visited
- `AI Analysis`
  - per-drive summary, guided actions, cross-drive AI summary
- `AI Chat`
  - follow-up questions after scan completion

## Project Structure

```text
disk-command-cockpit/
├─ server/
│  ├─ FastScanner.cs
│  ├─ scan-drive.ps1
│  ├─ ai-analysis.mjs
│  └─ index.mjs
├─ src/
│  ├─ App.tsx
│  ├─ components/
│  │  └─ CockpitViews.tsx
│  ├─ lib/format.ts
│  ├─ types.ts
│  └─ index.css
└─ docs/
   └─ step-by-step-log.md
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Run in development

```bash
npm run dev
```

This starts both:

- frontend via Vite
- backend via `node server/index.mjs`

### 3. Production build

```bash
npm run build
npm run start
```

## Environment Variables

### Optional: enable DeepSeek

```powershell
$env:DEEPSEEK_API_KEY="your_key"
```

Optional overrides:

```powershell
$env:DEEPSEEK_BASE_URL="https://api.deepseek.com"
$env:DEEPSEEK_MODEL="deepseek-chat"
$env:DEEPSEEK_TIMEOUT_MS="12000"
```

Without `DEEPSEEK_API_KEY`, the application still works with local heuristic fallback analysis.

## API

- `GET /api/snapshot`
- `POST /api/rescan`
- `POST /api/chat`
- `GET /api/health`

## Analysis Flow

The system builds a deterministic scan result first, then layers AI on top:

1. drive capacity and health
2. top-level hot directories and files
3. child expansion for focused heavy directories
4. notable large files and cache opportunities
5. cross-drive duplicates and normalization suggestions
6. DeepSeek structured analysis for each drive and for the whole system
7. follow-up AI chat after a drive scan is complete

## Verified

- `npm run lint`
- `npm run build`
- `node --check server/index.mjs`
- `node --check server/ai-analysis.mjs`
- measured full `C:` scan at about `37.4 seconds`
- verified `GET /api/health` with active scan and AI runtime status

## Notes

- the current default behavior is read-first analysis; it does not auto-delete or auto-migrate files
- scan latency still depends on drive size, directory fragmentation, permissions, and background file activity
- AI chat is available after the selected drive completes scanning
- on first launch, `server/scan-drive.ps1` compiles the scanner into the project-local `.runtime/` folder rather than writing to `C:`
