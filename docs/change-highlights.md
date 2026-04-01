# Change Highlights

## Aegis Disk Command

### 2026-04-02 Round 1
- Added AI-first disk analysis with DeepSeek and heuristic fallback.
- Split repository documentation into Chinese and English READMEs.

### 2026-04-02 Round 2
- Replaced repeated recursive scans with a single-pass fast scanner.
- Separated the scan queue from the AI queue to reduce wall-clock latency.
- Added scan-flow visualization, AI summaries, and AI chat.

### 2026-04-02 Round 3
- Added local private runtime storage in `.aegis/`.
- Added offline fallback based on the most recent successful online analysis cache.
- Added configurable AI providers, with DeepSeek as the default.
- Added dark, light, and follow-system themes.
- Added bilingual UI switching.
- Added a governance-report narrative style alongside the default operator style.
- Added a dedicated settings view for theme, language, provider, model, timeout, secret, and cache policy.
- Added a second documentation track:
  - `docs/change-highlights.md` for high-level milestones
  - `docs/step-by-step-log.md` for detailed decisions and execution
- Updated the local `process-log-sync` skill so future project work can keep summary and detailed logs synchronized.

### 2026-04-02 Round 4
- Fixed settings toggles so theme and narrative mode no longer snap back during background polling.
- Fixed the scan-result mapping bug between the fast scanner's PascalCase payload and the server's runtime state.
- Removed `undefined` and `NaN` leakage through stricter formatting and empty-state guards.
- Verified live scan data in the browser and confirmed non-empty top hotspots, focus areas, and scan counters.
- Enabled the local Figma plugin in `F:\.codex\config.toml` for future Codex sessions.
