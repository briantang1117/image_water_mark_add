# 图片工具箱（水印 + LUT 调色 · 批量版）

一个纯前端的图片批量处理工具：批量叠加水印 **并** 批量套用内置 3D LUT 调色配方。所有处理在浏览器本地完成，图片不上传服务器。可单张下载或批量打包为 ZIP（JPG 导出会写回原始 EXIF）。

## 功能特性

- 🖼️ **批量处理**：一次选择多张图片，批量加 LUT + 水印并打包 ZIP
- 🎨 **LUT 调色**：内置多套 Rec.709 风格配方（人像 / 日系 / 扫街 / 大师），浓度可调，默认按 **Rec.709 还原模式**渲染，另附 sRGB 直查作 Photoshop 对照
- 💧 **多种水印**：内置多种相机/机型水印（横/竖屏），每张图可独立配置
- 🎭 **混合模式**：Screen 滤色、Lighten 增亮、Soft-Light 柔光、Multiply 正片叠底、正常叠加
- 📐 **适配模式**：Contain / Cover / Original
- 💾 **导出格式**：JPG / PNG，JPG 质量可调；JPG 写回原始 EXIF
- 📊 **原图/效果图**：一键切换对比
- 🔬 **校验工具**：色彩测试图生成器 + ΔE2000 差分对比工具（开发/验证用）
- 📱 **移动端兼容**：可嵌入 iOS WKWebView，支持原生相册选择与保存

## 技术栈

- **Vite 5** - 构建工具
- **Vue 3** - 前端框架（Composition API + `<script setup>`）
- **TypeScript** - 类型安全
- **WebGL2** - LUT 渲染（GPU 3D 纹理三线性插值）
- **vue-router** - 主界面 + 校验工具视图
- **ESLint** + **Prettier** - 代码规范与格式化
- **JSZip** - 批量导出 ZIP 压缩包
- **pnpm** - 包管理器

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器（默认端口 5173，自动打开浏览器）
pnpm dev

# 类型检查 + 生产构建（输出到 dist/）
pnpm build

# 预览构建结果
pnpm preview

# 代码检查与自动修复
pnpm lint

# 代码格式化
pnpm format
```

> ⚠️ **需要支持 WebGL2 的浏览器**（新版 Safari / Chrome / Edge）。不支持时 LUT 调色会被禁用并明确提示，带 LUT 导出会被阻止（不会静默导出原图）。

## 使用说明

1. 点击 **「选择图片」** 上传照片
2. 在缩略图列表选择要预览的图片
3. 底部 **「💧 水印」Tab**：选择水印、混合模式，调整不透明度/大小/位置
4. 底部 **「🎨 LUT 调色」Tab**：选择分类与配方，调整浓度；默认 Rec.709 还原，sRGB 直查仅作对照
5. 预览区可点 **「🖼 原图 / ✨ 效果图」** 对比
6. 点击 **「下载当前」** 或 **「下载全部 (ZIP)」** 导出

### 关于 LUT 渲染模式

内置配方按「真 Rec.709（视频显示信号）」输入制作，即达芬奇里 `dlog → Rec.709 → 套 LUT` 之后再套的那类配方。因此默认渲染链路为：

```
sRGB → 线性 → Rec.709 显示信号(BT.1886，γ≈2.4) → LUT 查表 → 逆变换 → sRGB
```

若你的达芬奇项目把 709 当 Gamma 2.2 处理，改 `src/utils/lutRenderer.ts` 顶部 `REC709_DISPLAY_GAMMA` 常量即可。

## 技术说明

- **纯前端**：所有处理在浏览器本地完成，图片不会上传到服务器
- **WebGL2 渲染 LUT**：上传前统一经 sRGB Canvas 归一（兼容 ICC / Display-P3 图片），并按 GPU 纹理上限自动降采样；预览/导出结果一致
- **Canvas2D 画水印**：水印不参与 LUT 调色，颜色准确；JPG 导出写回原始 EXIF
- **原生桥接**：检测到 iOS WKWebView 时，通过 `window.webkit.messageHandlers.native` 交互
- **路径别名**：`@/` 指向 `src/` 目录

### 混合模式说明

- **Screen 滤色**（默认）：适用于黑底水印，黑色区域会变透明
- **Lighten 增亮**：只提亮暗部区域
- **Soft-Light 柔光**：柔和叠加效果
- **Multiply 正片叠底**：适用于白底水印
- **正常叠加**：直接覆盖

## 项目结构

```
dji-water/
├── src/
│   ├── assets/
│   │   ├── watermarks/            # 水印图片资源
│   │   └── luts/<分类>/*.cube      # 内置 LUT 配方（新增配方=加文件）
│   ├── components/                # Vue 组件
│   │   ├── ControlToolbar.vue     # 水印控制面板
│   │   ├── LutPanel.vue           # LUT 面板（分类/配方/浓度/模式）
│   │   ├── PreviewPanel.vue       # 预览画布（LUT + 水印合成）
│   │   └── ThumbPanel.vue         # 缩略图列表面板
│   ├── composables/
│   │   ├── useWatermark.ts        # 图片列表 + 水印状态/渲染/导出
│   │   └── useLut.ts              # LUT 状态（每图独立配置）
│   ├── constants/
│   │   ├── index.ts               # 水印选项与默认参数
│   │   └── luts.ts                # 扫描内置 .cube → 分类/配方，懒解析缓存
│   ├── router/                    # 主界面 + 校验工具路由
│   ├── styles/global.css
│   ├── types/index.ts
│   ├── utils/
│   │   ├── index.ts               # 水印绘制、EXIF、原生桥等
│   │   ├── cubeParser.ts          # .cube 解析
│   │   ├── lutRenderer.ts         # WebGL2 3D LUT 渲染器
│   │   ├── exportWithLut.ts       # LUT + 水印 合成导出
│   │   └── colorDiff.ts           # CIEDE2000（差分工具用）
│   ├── views/
│   │   ├── HomeView.vue           # 主界面
│   │   ├── DiffView.vue           # ΔE2000 差分对比工具
│   │   └── TestPatternView.vue    # 色彩测试图生成器
│   ├── App.vue
│   └── main.ts
├── docs/
│   ├── Web端 3D LUT(Cube)图片调色工具 完整技术方案文档.md   # 色彩科学原理 + 落地定案
│   └── LUT调色链路整改方案.md                             # 缺陷修复记录（开发用）
├── index.html
├── vite.config.ts
├── tsconfig.json
└── ...
```

## License

MIT
