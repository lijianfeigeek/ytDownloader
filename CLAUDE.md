# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YTDownloader is a modern Electron-based GUI application for downloading videos and audio from hundreds of websites using yt-dlp. The application is cross-platform (Windows, macOS, Linux, FreeBSD) and supports multiple languages.

## Architecture

### Core Structure
- **Main Process**: `main.js` - Electron main process handling window management, IPC, auto-updater, and system tray
- **Renderer Processes**: HTML files in `/html/` directory with corresponding JavaScript files in `/src/`
- **Core Modules**:
  - `src/renderer.js` - Main UI logic and download management
  - `src/playlist.js` - Playlist download functionality
  - `src/compressor.js` - Video compression with hardware acceleration
  - `src/preferences.js` - Application settings and configuration
  - `src/common.js` - Shared utilities
  - `src/types.d.ts` - TypeScript type definitions

### Key Technologies
- Electron 30.0.0 with nodeIntegration enabled, contextIsolation disabled
- yt-dlp-wrap-plus for video downloading
- ffmpeg for video/audio processing
- electron-updater for auto-updates
- Custom i18n system with JSON translation files

### File Organization
- `/html/` - UI templates (index.html, preferences.html, playlist.html, etc.)
- `/src/` - JavaScript modules and utilities
- `/assets/` - Application icons and images
- `/translations/` - i18n JSON files (20+ languages supported)
- `/resources/` - Build resources and platform-specific assets
- `main.js` - Electron main process entry point

## Development Commands

### Setup
```bash
git clone https://github.com/aandrew-me/ytDownloader.git
cd ytDownloader
npm i
```

### Development
```bash
npm start          # Run with Electron
npm run debug      # Run with Node.js debugging on port 5858
```

### Building
```bash
npm run windows    # Build for Windows (creates exe, msi, zip)
npm run linux      # Build for Linux (creates AppImage, snap, rpm, deb, zip)
npm run mac        # Build for macOS (creates zip, dmg)
npm run dist       # Build for current platform
```

### Platform-specific builds
```bash
npx electron-builder -l appimage    # Linux AppImage only
npx electron-builder -w nsis        # Windows NSIS installer only
```

### Publishing (requires ffmpeg)
```bash
npm run publish-windows  # Windows with auto-update
npm run publish-linux    # Linux with auto-update
npm run publish-mac      # macOS with auto-update
```

## FFmpeg Requirements

FFmpeg must be present in the project root for builds:
- Run `windows.sh`, `mac.sh`, or `linux.sh` to download appropriate ffmpeg binary
- For ARM processors, download manually from yt-dlp FFmpeg-Builds releases
- macOS users also need: `brew install yt-dlp`

## Configuration

- Main config: `main.js:23` - Path to user config JSON
- Build configuration: `package.json` electron-builder section
- i18n configuration: `translations/i18n.js`

## Key Features Implementation

- **Download Management**: Handled in `src/renderer.js` with yt-dlp-wrap-plus
- **Multi-language Support**: Custom i18n system using JSON files in `/translations/`
- **Video Compression**: Hardware-accelerated compression via `src/compressor.js`
- **System Integration**: System tray, auto-updater, clipboard monitoring in `main.js`
- **Cross-platform Builds**: Electron Builder with platform-specific configurations

## Testing

No automated test suite is present. Manual testing involves:
1. Running `npm start` for development
2. Testing download functionality across supported sites
3. Verifying compression features
4. Testing UI preferences and settings
5. Validating builds on target platforms
- @/Users/lijianfei/Desktop/ytDownloader/ARCHITECTURE.md