# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**图片工具箱（水印 + LUT 调色 · 批量版）** — A Vue 3 + TypeScript single-page app for batch-processing photos: overlay watermarks **and** apply built-in 3D LUT color recipes. Built with Vite, managed with pnpm. No backend; everything runs in the browser.

- **水印叠加**：批量给照片叠相机/机型水印，支持混合模式、适配模式、位置大小与 JPG/PNG 导出。
- **LUT 调色（WebGL2）**：批量给照片套内置 Rec.709 风格配方，单张/全部导出，JPG 写回原始 EXIF。
- **校验工具页**：色彩测试图生成 + ΔE2000 差分对比，用于验证 LUT 渲染与 PS / 达芬奇一致（不参与主流程）。

## Architecture

### Tech Stack
- **Vite 5** — Build tool
- **Vue 3** — Framework（Composition API + `<script setup>`）
- **TypeScript** — Strict mode
- **WebGL2** — LUT 渲染（GPU 3D 纹理三线性插值）
- **vue-router** — 主界面 HomeView + 校验工具视图（DiffView / TestPatternView）
- **JSZip** — Batch ZIP export（npm 依赖）
- **ESLint + Prettier** — Code quality

### Directory Layout

```
src/
├── main.ts                  # 入口
├── App.vue                  # 根组件（路由出口 RouterView）
├── assets/
│   ├── watermarks/          # 水印 PNG（相机/机型 × 横竖屏）
│   └── luts/<分类>/*.cube   # 内置 LUT 配方（目录=分类，新增配方=加 .cube 文件）
├── components/
│   ├── ControlToolbar.vue   # 水印控制面板（水印栏）
│   ├── LutPanel.vue         # LUT 面板（调色栏：分类/配方/浓度/模式）
│   ├── ExportPanel.vue      # 导出面板（导出栏：格式/质量/下载当前/全部 ZIP）
│   ├── PreviewPanel.vue     # 预览画布（LUT 底图 + 水印合成 + WebGL2 能力横幅）
│   └── ThumbPanel.vue       # 缩略图列表（末尾「+」添加，最多 9 张硬上限）
├── composables/
│   ├── useWatermark.ts      # 图片列表 + 水印参数/渲染/导出
│   └── useLut.ts            # LUT 状态（每图独立 lutId/lutIntensity/lutMode）+ 分类切换
├── constants/
│   ├── index.ts             # 水印选项与默认参数
│   └── luts.ts              # glob 扫描内置 .cube，构建分类/配方，懒解析缓存
├── router/index.ts          # HomeView / DiffView / TestPatternView
├── styles/global.css
├── types/index.ts           # ImageItem / Lut3D / LutMode 等
├── utils/
│   ├── index.ts             # 水印绘制、EXIF 解析/写回、原生桥、命名等
│   ├── cubeParser.ts        # .cube 解析（R-fastest 约定）→ Lut3D
│   ├── lutRenderer.ts       # WebGL2 3D LUT 渲染器 + 能力检测
│   ├── exportWithLut.ts     # LUT+水印 合成导出 Blob（含 EXIF 回写）
│   └── colorDiff.ts         # sRGB→Lab、CIEDE2000、伪彩（供 DiffView）
└── views/
    ├── HomeView.vue         # 主界面（上 50% 预览+缩略图；下 50% 三步工作区：调色/水印/导出）
    ├── DiffView.vue         # 双图 ΔE2000 差分对比工具
    └── TestPatternView.vue  # 色彩测试图生成器（LUT 校验用）
```

### Key Files & Concepts

- **`useWatermark.ts`** — 图片列表 `imageList: ImageItem[]`、水印参数、`addFiles`、`exportImageDataURL`。每张 `ImageItem` 带独立的 `lutId / lutIntensity / lutMode / originalBuffer`。
- **`useLut.ts`** — LUT 状态按**当前图片**读写（`currentImage.lutId` 等）；`currentLutId`/`intensity`/`mode` 均为 per-image computed。分类切换会预加载该分类配方。
- **`constants/luts.ts`** — `import.meta.glob('@/assets/luts/*/*.cube', { query: '?raw' })` 自动发现配方；`getLutData(value)` 懒解析并全局缓存。新增分类/LUT 只需在 `assets/luts/` 加文件，不改代码。
- **`cubeParser.ts`** — `.cube` 解析。**行序约定：内置文件均为 R-fastest（R 最内层变化最快）**，与解析布局 `data[(b·S² + g·S + r)·3]` 一致，勿改这个假设。`parseCubeFileFromFile` 仅为工具函数，**当前无用户导入 UI**。
- **`lutRenderer.ts`（LutRenderer）** — 核心渲染器，**务必了解**：
  - `uploadImage` 幂等（同源跳过重传），`invalidateImage()` 强制重传；上传源统一经 `prepareUploadSource`（画进 sRGB Canvas2D 归一 + 超限降采样到 `MAX_TEXTURE_SIZE`），上传后 `assertNoGlError`。
  - 双渲染模式由 `mode` 控制（见下方"渲染语义"）。
  - `getSafeCanvasSize` 供预览/导出用安全尺寸渲染，回贴时由 2D 层拉伸回原尺寸。
- **`exportWithLut.ts`** — 合成导出。渲染顺序：原图 → LUT（WebGL2）→ 水印（Canvas2D，不参与调色）→ JPG 写回 EXIF。**带 LUT 而浏览器不支持 WebGL2 时直接 throw**（不允许静默导出原图）。
- **原生 bridge / 移动端** — `isNativeApp()` / `postToNative()` / `window.__onImagePicked`；移动端 safe-area + `100dvh`。

### LUT 渲染语义（重要，不要随手改默认）

- **默认模式 = sRGB 直查（`lutMode: 'ps'`）**，与 Photoshop「颜色查找」一致，适合多数风格化配方（尤其 PS/LR/手机生态）。不要随手改成别的默认。
- 链路：`sRGB → srgbToLinear → E'=L^(1/γ)（Rec.709 显示信号）→ LUT 查表 → L=E'^γ → linearToSrgb`。
- **γ 取 2.4（BT.1886 参考近似）**，常量 `REC709_DISPLAY_GAMMA`（`lutRenderer.ts` 顶部）。若目标达芬奇时间线是 Gamma 2.2，改此常量即可——用纯幂律，**不要**换回 BT.709 摄像机 OETF 分段公式（那是捕获端编码，不适用于显示图互转）。
- 查表前输入经 `domainMap` 按 `DOMAIN_MIN/MAX` 归一到 [0,1]。
- `'professional'` = Rec.709 还原（手动）：把 sRGB 图重编码为 Rec.709 显示信号后查表，等价达芬奇「dlog → Rec.709 → 套 LUT」，用于真 Rec.709 输入配方或 709 视频帧素材。

### Development Guardrails（防回归，务必遵守）

1. **禁止静默降级**：任何"功能不可用/超限"都要对用户可见（横幅/置灰/报错）。带 LUT 导出遇 WebGL2 缺失必须抛错，不能悄悄输出原图。
2. GPU 上传（`texImage2D/3D`）后要 `assertNoGlError`；不吞错误。
3. 上传前检查纹理尺寸上限；不要假设图片一定 ≤ `MAX_TEXTURE_SIZE`。
4. 单一默认来源：新建 `ImageItem` 的 `lutMode` 统一为 `'ps'`。
5. 注释不能比实现更强断言（避免"对齐 DaVinci Resolve"这类言过其实的表述）。
6. **不开放用户导入 .cube**：配方只来自内置目录，行序 R-fastest 假设因此安全。

## How to Run / Develop

```bash
pnpm install    # install dependencies
pnpm dev        # dev server (port 5173, auto-open)
pnpm build      # type-check + production build (dist/)
pnpm preview    # preview production build
pnpm lint       # ESLint check with --fix
pnpm format     # Prettier write
```

## Testing

No test framework. LUT 正确性用手动 + 内置工具校验：
1. `TestPatternView` 导出灰阶/RGB 渐变测试图；
2. 工具内套配方导出 → Photoshop / 达芬奇对同图应用同 `.cube` 导出 → `DiffView`（ΔE2000）对比。
ΔE 应整体极低；若有系统性暗部/中调偏移，多半是 `REC709_DISPLAY_GAMMA` 2.4 vs 2.2 的问题。

## Linting / Formatting

- ESLint（`.eslintrc.cjs`）：`eslint:recommended` + `plugin:vue/vue3-recommended` + `@typescript-eslint/recommended` + `plugin:prettier/recommended`
- Prettier（`.prettierrc.json`）：no semi, single quote, trailing comma all, print width 100

## Key Notes

- **Path alias**：`@/` → `src/`（`vite.config.ts` + `tsconfig.json`）。
- **Strict TS**：`strict: true` + `noUnusedLocals/noUnusedParameters`。
- **黑底水印**：默认 blend `screen`（黑色透明）。
- **Vue 组件命名**：模板 PascalCase，多词组件名已允许。
- 色彩/渲染的详细论证与整改历史见 `docs/`：`Web端 3D LUT(Cube)图片调色工具 完整技术方案文档.md`（原理）与 `LUT调色链路整改方案.md`（缺陷修复记录）。
