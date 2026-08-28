# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DJI 水印叠加工具（批量版）** — A Vue 3 + TypeScript single-page app for batch-overlaying watermarks onto photos. Built with Vite, managed with pnpm.

## Architecture

### Tech Stack
- **Vite 5** — Build tool
- **Vue 3** — Framework (Composition API + `<script setup>`)
- **TypeScript** — Type safety (strict mode)
- **JSZip** — Batch ZIP export (installed via npm, no CDN dependency)
- **ESLint + Prettier** — Code quality & formatting

### Directory Layout

```
src/
├── main.ts              # App entry, mounts App.vue
├── App.vue              # Root component, orchestrates layout + state
├── env.d.ts             # Global type declarations (window.webkit, *.vue)
├── assets/              # 4 PNG watermark images (bundled by Vite)
│   ├── op4p_horizontal.png
│   ├── op4p_vertical.png
│   ├── a7c_horizontal.png
│   └── a7c_vertical.png
├── components/
│   ├── ControlToolbar.vue   # Top toolbar: selects, sliders, buttons
│   ├── PreviewPanel.vue     # Right panel: canvas preview
│   └── ThumbPanel.vue       # Left panel: thumbnail list
├── composables/
│   └── useWatermark.ts      # Core state + logic (image list, params, render, export)
├── constants/index.ts       # Select options, default params
├── styles/global.css        # Global styles (layout, buttons, rows, sliders)
├── types/index.ts           # Shared TypeScript interfaces & types
└── utils/index.ts           # Pure utility functions
```

### Key Files & Concepts

- **`useWatermark.ts`** — The central composable holding all reactive state:
  - `imageList: ImageItem[]` — array of `{ id, name, img, thumbDataURL }`
  - `params` — reactive object with all watermark settings (wmKey, blendMode, fitMode, opacity, scale, posX, posY, format, quality)
  - `preloadWatermarks()` — loads all 4 watermark images on mount
  - `addFiles(fileList)` — batch-adds images from FileList
  - `renderToCanvas(ctx, w, h, img)` — draws image + watermark to a 2D context
  - `exportImageDataURL(img)` — renders to offscreen canvas, returns `{ dataURL, ext }`
  - `resetParams()` — resets to defaults

- **Watermark rendering** — `drawWatermark()` in `utils/index.ts` handles sizing/positioning with `contain` / `cover` / `original` fit modes. Uses `globalCompositeOperation` for blend modes. Default blend is `screen` because watermark PNGs have black backgrounds.

- **Native app bridge** — `isNativeApp()` from `utils/index.ts` detects `window.webkit.messageHandlers.native` (iOS WKWebView). When running in a native app, image pick and save actions are delegated to the native side via `postToNative()`. The native side calls `window.__onImagePicked(dataURL, fileName)` (registered in `App.vue` onMounted) to inject an image.

- **File naming convention** — Exported files are named `{original_base}_wm.{ext}` (e.g., `photo_wm.jpg`).

## How to Run / Develop

```bash
pnpm install    # install dependencies
pnpm dev        # start dev server (port 5173, auto-open)
pnpm build      # type-check + production build (outputs to dist/)
pnpm preview    # preview production build
pnpm lint       # ESLint check with --fix
pnpm format     # Prettier write
```

## Testing

No test framework exists. Test manually in the browser via `pnpm dev`.

## Linting / Formatting

- **ESLint** (`.eslintrc.cjs`): `eslint:recommended` + `plugin:vue/vue3-recommended` + `@typescript-eslint/recommended` + `plugin:prettier/recommended`
- **Prettier** (`.prettierrc.json`): no semi, single quote, trailing comma all, print width 100

## Key Notes

- **Path alias**: `@/` resolves to `src/` (configured in both `vite.config.ts` and `tsconfig.json`).
- **Strict TypeScript**: `strict: true`, `noUnusedLocals`, `noUnusedParameters` are enabled.
- **JSZip is bundled**: no CDN dependency — it's a regular npm dependency.
- **Black-base watermarks**: default blend mode is `screen` (black becomes transparent).
- **Vue component naming**: PascalCase in templates, multi-word names are allowed (rule turned off).
