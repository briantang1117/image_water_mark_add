# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DJI 水印叠加工具（批量版）** — A single-page web app for batch-overlaying watermarks onto photos. The entire application lives in `index.html` (HTML + inline CSS + inline JS). There is no build step, no package manager, and no framework.

## Architecture

- **`index.html`** — All application code in one file:
  - **HTML** (lines 1–206 head/styles, 208–320 body): UI layout with a two-column main layout (left: thumbnail panel, right: canvas preview) and a toolbar at the top with controls.
  - **JavaScript** (lines 322–837): All logic is vanilla JS with no framework.
    - `imageList` array holds `{ id, name, img, thumbDataURL }` — the in-memory state of uploaded images.
    - `watermarks` object caches preloaded watermark `Image` objects (4 variants: op4p/a7c × horizontal/vertical).
    - `render()` draws the currently selected image + watermark onto `<canvas>` using 2D context compositing.
    - `exportImageDataURL()` does the same render but on an offscreen canvas for export.
    - `drawWatermark()` handles sizing/positioning with `contain`/`cover`/`original` fit modes.
    - Batch download uses **JSZip** (loaded from CDN: `jsdelivr.net/npm/jszip@3.10.1`).
    - Native app bridge: `isNativeApp()` detects `window.webkit.messageHandlers.native` (iOS WKWebView). When running in a native app, image pick and save actions are delegated to the native side via `postMessage`.

- **`assets/`** — 4 PNG watermark images:
  - `op4p_horizontal.png`, `op4p_vertical.png` — DJI Osmo Pocket 4 Pro watermarks
  - `a7c_horizontal.png`, `a7c_vertical.png` — Sony A7C watermarks

## How to Run / Develop

This is a pure static site. No build, no install.

- **Open locally**: Open `index.html` directly in a browser, or serve with any static server:
  ```bash
  # Python
  python3 -m http.server 8000
  # Node
  npx serve .
  ```
  Then visit `http://localhost:8000`.

- **Testing**: No test framework exists. Test manually in the browser.

- **Linting / formatting**: No linter or formatter is configured.

## Key Notes

- **JSZip is CDN-only**: The batch ZIP feature requires internet access. If JSZip fails to load, only single-image download works.
- **Black-base watermarks**: The default blend mode is `screen` because the watermark PNGs have black backgrounds (screen mode makes black transparent).
- **Native app integration**: The app supports being embedded in an iOS WKWebView. The bridge protocol uses `window.webkit.messageHandlers.native.postMessage()` with actions `pickImage` and `saveImage`. The native side calls `window.__onImagePicked(dataURL, fileName)` to inject an image.
- **File naming convention**: Exported files are named `{original_base}_wm.{ext}` (e.g., `photo_wm.jpg`).
