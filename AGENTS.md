# Repository Guidelines

## Project Structure & Module Organization
- `main.js` hosts the Electron main process, app lifecycle, and updater wiring.
- `src/` holds renderer-side controllers (e.g., `index.js`, `compressor.js`, `preferences.js`) plus shared helpers.
- `html/` contains window layouts; keep DOM ids in sync with their companion scripts in `src/`.
- `assets/` stores icons and images; `resources/` contains electron-builder branding resources and metadata.
- `translations/` tracks Crowdin-synced locale JSON; initiate updates via Crowdin instead of manual edits.
- Platform packaging files live in `flatpak/`, `ytdownloader.json`, and the `linux.sh`/`mac.sh`/`windows.sh` helper scripts.

## Build, Test, and Development Commands
- `npm install` – install Electron, builder tooling, and the yt-dlp wrapper dependencies.
- `npm start` – launch the app locally; requires an `ffmpeg` binary placed in the repo root (run the OS-specific shell script to fetch one).
- `npm run debug` – start Electron with the inspector exposed on port 5858.
- `npm run linux|windows|mac` – build platform installers into `release/` via electron-builder.
- `npm run dist` – produce the distribution set declared in `package.json`.

## Coding Style & Naming Conventions
- Use tab indentation and double quotes for strings, matching the existing codebase.
- Prefer camelCase for functions and variables; reserve UpperCamelCase for classes and user-facing product names.
- Keep renderer logic modular: each HTML view should map to a same-named script in `src/`; share utilities through `src/common.js`.
- Preserve the TypeScript hints in `src/types.d.ts`, and name IPC channels descriptively (e.g., `download:enqueue`).

## Testing Guidelines
- No automated suite exists; manually validate download, compression, and preferences flows after changes.
- For platform-specific adjustments, test on that OS or document the validation steps performed.
- Run at least one packaging build (`npm run linux` works cross-platform) to ensure electron-builder still succeeds.

## Commit & Pull Request Guidelines
- Follow the current history: concise, present-tense summaries (`Update winget info`, `macOS and FreeBSD fixes`).
- Link related issues or distribution tickets in the PR description.
- Include UI screenshots/GIFs for visual changes, platform test results, and how ffmpeg assets were handled.
- When altering localization, reference the Crowdin activity or note any new placeholders required.

## Platform Packaging & FFmpeg Notes
- Keep ffmpeg binaries out of version control; rely on helper scripts or the documented download sources.
- Update `package.json` build targets and platform manifests together to avoid mismatched artifacts.
