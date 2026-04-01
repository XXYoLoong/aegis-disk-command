# Aegis Disk Command

[中文 README](./README.md)

[![Stars](https://img.shields.io/github/stars/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/stargazers)
[![Forks](https://img.shields.io/github/forks/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/network/members)
[![Issues](https://img.shields.io/github/issues/XXYoLoong/aegis-disk-command?style=flat-square)](https://github.com/XXYoLoong/aegis-disk-command/issues)
[![Windows](https://img.shields.io/badge/Windows-Only-0b6cff?style=flat-square)](https://www.microsoft.com/windows)
[![React](https://img.shields.io/badge/React-19-0ea5e9?style=flat-square)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-7c3aed?style=flat-square)](https://vite.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-Express-1f7a43?style=flat-square)](https://nodejs.org/)
[![DeepSeek Default](https://img.shields.io/badge/Default-DeepSeek-2563eb?style=flat-square)](https://api-docs.deepseek.com/)

A local Windows disk-governance cockpit with real-time scanning, cross-drive analysis, multi-provider AI, offline fallback, and configurable narrative styles.

![Overview](./docs/screenshots/settings-overview-dark.png)

![Settings](./docs/screenshots/settings-panel-dark.png)

## What This Version Changes

- removes machine-specific assumptions from the public repository
- moves private runtime configuration into `.aegis/`
- keeps the latest successful online analysis cache for offline fallback
- expands AI support from a single provider to a configurable provider catalog
- adds dark, light, and follow-system themes
- adds bilingual UI switching
- adds two narrative styles:
  - default operator style
  - governance-report style that treats each drive like a governed region
- adds a dedicated settings view for themes, language, narrative style, providers, models, base URLs, secrets, and cache policy

## Core Capabilities

### 1. Fast scan pipeline

- `server/FastScanner.cs` performs a single-pass aggregated scan
- PowerShell is now only the invocation layer
- scan progress is visualized with:
  - current phase
  - root-task progress
  - file count
  - directory count
  - bytes seen
  - current root and current path

### 2. Multi-provider AI

Built-in provider presets:

- DeepSeek
- Qwen
- Zhipu
- Doubao
- Kimi
- OpenAI
- Google
- Claude
- OpenRouter
- SiliconFlow

DeepSeek remains the default, but every preset can be edited from the settings view.

### 3. Local private configuration and offline fallback

The app creates a private runtime directory in the repository root:

```text
.aegis/
├─ settings.json
├─ local.env
└─ last-online-cache.json
```

Behavior:

1. configure network access and an AI provider on first setup
2. every later successful online analysis refreshes the local cache
3. if the machine is offline later, the app can fall back to the most recent online cache
4. these files are git-ignored and never pushed to the public repository

### 4. Multi-view workspace

- `Overview`
- `Drive`
- `Scan`
- `AI`
- `Chat`
- `Settings`

The app is no longer a single giant screen. Each operational task now has its own focused view.

## Project Structure

```text
disk-command-cockpit/
├─ server/
│  ├─ FastScanner.cs
│  ├─ scan-drive.ps1
│  ├─ ai-analysis.mjs
│  ├─ fallback-analysis.mjs
│  ├─ local-store.mjs
│  ├─ provider-catalog.mjs
│  └─ index.mjs
├─ src/
│  ├─ App.tsx
│  ├─ i18n.ts
│  ├─ types.ts
│  ├─ lib/format.ts
│  ├─ components/CockpitViews.tsx
│  └─ index.css
├─ docs/
│  ├─ change-highlights.md
│  ├─ step-by-step-log.md
│  └─ screenshots/
└─ .env.example
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Development mode

```bash
npm run dev
```

### 3. Production mode

```bash
npm run build
npm run start
```

Default address:

```text
http://127.0.0.1:5525
```

## Configuration

### Recommended: use the settings view

Open the `Settings` view after launch to configure:

- theme mode
- UI language
- narrative style
- AI provider
- base URL, model, timeout, and secret
- offline cache policy

### Compatibility mode: environment variables

Legacy environment-based configuration is still supported through:

- [`.env.example`](./.env.example)

But the preferred path is now the settings view, because it keeps private settings and online-cache state together in `.aegis/`.

## Verification

Validated in this round:

- `node --check server/index.mjs`
- `node --check server/ai-analysis.mjs`
- `npm run lint`
- `npm run build`
- `/api/settings`
- `/api/providers`

The previous scan-speed improvement is also preserved:

- default full scan of `C:` at about `37.4 seconds`

## Figma Note

This request also asked for a Figma-first design pass. The current session does not have an active Figma MCP / design-file connection, so this round implemented the new theme system, layout, and settings surface directly in code first. If a Figma connection is added later, the current UI can be synced into Figma as the next step.

## References

The provider strategy in this round was based on official documentation or official provider sites:

- DeepSeek Chat Completions: https://api-docs.deepseek.com/api/create-chat-completion/
- OpenAI API Docs: https://developers.openai.com/api/
- Gemini OpenAI Compatibility: https://ai.google.dev/gemini-api/docs/openai
- Anthropic Messages Examples: https://docs.anthropic.com/en/api/messages-examples
- DashScope OpenAI Compatibility: https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
- Moonshot Official Blog: https://platform.moonshot.cn/blog
- Volcengine Docs: https://www.volcengine.com/docs
- Zhipu Open Platform: https://open.bigmodel.cn/
