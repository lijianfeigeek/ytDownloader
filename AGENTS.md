# Repository Guidelines

## Project Structure & Module Organization
- `main.js` hosts the Electron main process, app lifecycle, and updater wiring.
- `src/` holds renderer-side controllers (e.g., `index.js`, `compressor.js`, `preferences.js`, `transcribe.js`) plus shared helpers.
- `src/jobs/` contains job management modules for offline transcription (queue.js, download.js, audio.js, transcribe.js).
- `html/` contains window layouts; keep DOM ids in sync with their companion scripts in `src/`.
- `assets/` stores icons and images; `resources/` contains electron-builder branding resources, metadata, and runtime binaries.
- `resources/runtime/bin/` stores downloaded binaries (yt-dlp, ffmpeg); `resources/runtime/whisper/` stores whisper.cpp and models.
- `scripts/setup-offline.js` handles automatic dependency download and configuration for offline transcription.
- `translations/` tracks Crowdin-synced locale JSON; initiate updates via Crowdin instead of manual edits.
- Platform packaging files live in `flatpak/`, `ytdownloader.json`, and the `linux.sh`/`mac.sh`/`windows.sh` helper scripts.

## Build, Test, and Development Commands
- `npm install` – install Electron, builder tooling, and the yt-dlp wrapper dependencies.
- `npm start` – launch the app locally; requires an `ffmpeg` binary placed in the repo root (run the OS-specific shell script to fetch one).
- `npm run debug` – start Electron with the inspector exposed on port 5858.
- `npm run linux|windows|mac` – build platform installers into `release/` via electron-builder.
- `npm run dist` – produce the distribution set declared in `package.json`.
- `npm run setup-offline` – download and configure offline transcription dependencies (yt-dlp, ffmpeg, whisper.cpp, Whisper model).

## Coding Style & Naming Conventions
- Use tab indentation and double quotes for strings, matching the existing codebase.
- Prefer camelCase for functions and variables; reserve UpperCamelCase for classes and user-facing product names.
- Keep renderer logic modular: each HTML view should map to a same-named script in `src/`; share utilities through `src/common.js`.
- Preserve the TypeScript hints in `src/types.d.ts`, and name IPC channels descriptively (e.g., `download:enqueue`).

## Testing Guidelines
- No automated suite exists; manually validate download, compression, and preferences flows after changes.
- For platform-specific adjustments, test on that OS or document the validation steps performed.
- Run at least one packaging build (`npm run linux` works cross-platform) to ensure electron-builder still succeeds.
- **Offline Transcription Testing**:
  - Run `npm run setup-offline` to verify dependency download and configuration.
  - Test dependency checking via the Offline Transcribe → Check Dependencies GUI.
  - Verify binary path auto-configuration works on fresh installations.
  - Test Metal GPU acceleration on macOS and CPU fallback on other platforms.

## Commit & Pull Request Guidelines
- Follow the current history: concise, present-tense summaries (`Update winget info`, `macOS and FreeBSD fixes`).
- Link related issues or distribution tickets in the PR description.
- Include UI screenshots/GIFs for visual changes, platform test results, and how ffmpeg assets were handled.
- When altering localization, reference the Crowdin activity or note any new placeholders required.

## Platform Packaging & FFmpeg Notes
- Keep ffmpeg binaries out of version control; rely on helper scripts or the documented download sources.
- Update `package.json` build targets and platform manifests together to avoid mismatched artifacts.
