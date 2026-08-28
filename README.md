# 水印叠加工具（批量版）

一个纯前端的图片批量水印叠加工具，支持多种水印样式、混合模式、位置/大小调节，可单张下载或批量打包为 ZIP。

## 功能特性

- 🖼️ **批量处理**：一次选择多张图片，批量添加水印并打包下载
- 🎨 **多种水印**：内置 4 种水印（DJI OP4P 横/竖屏、索尼 A7C 横/竖屏）
- 🔧 **灵活调节**：不透明度、大小、X/Y 位置自由调整
- 🎭 **混合模式**：Screen 滤色、Lighten 增亮、Soft-Light 柔光、Multiply 正片叠底、正常叠加
- 📐 **适配模式**：Contain 完整显示、Cover 铺满裁切、Original 原始尺寸
- 💾 **导出格式**：JPG / PNG，JPG 质量可调
- 📱 **移动端兼容**：可嵌入 iOS WKWebView，支持原生相册选择与保存

## 技术栈

- **Vite 5** - 构建工具
- **Vue 3** - 前端框架（Composition API + `<script setup>`）
- **TypeScript** - 类型安全
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

## 使用说明

1. 点击 **「选择多张图片」** 上传需要加水印的照片
2. 在左侧缩略图列表中选择要预览的图片
3. 在顶部工具栏中选择水印样式、混合模式，调整不透明度、大小、位置
4. 点击 **「下载当前图片」** 保存单张，或 **「下载全部 (ZIP)」** 批量打包下载

## 技术说明

- **纯前端**：所有处理在浏览器本地完成，图片不会上传到服务器
- **Canvas 渲染**：使用 HTML5 Canvas 2D API 进行图像合成
- **JSZip**：用于批量导出 ZIP 压缩包（npm 包，无需 CDN）
- **原生桥接**：检测到 iOS WKWebView 环境时，通过 `window.webkit.messageHandlers.native` 与原生代码交互
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
│   ├── assets/                 # 水印图片资源
│   │   ├── op4p_horizontal.png
│   │   ├── op4p_vertical.png
│   │   ├── a7c_horizontal.png
│   │   └── a7c_vertical.png
│   ├── components/             # Vue 组件
│   │   ├── ControlToolbar.vue  # 顶部控制工具栏
│   │   ├── PreviewPanel.vue    # 画布预览面板
│   │   └── ThumbPanel.vue      # 缩略图列表面板
│   ├── composables/            # 组合式函数
│   │   └── useWatermark.ts     # 水印核心逻辑（状态 + 渲染）
│   ├── constants/              # 常量定义
│   │   └── index.ts
│   ├── styles/                 # 全局样式
│   │   └── global.css
│   ├── types/                  # TypeScript 类型定义
│   │   └── index.ts
│   ├── utils/                  # 工具函数
│   │   └── index.ts
│   ├── App.vue                 # 根组件
│   ├── env.d.ts                # 全局类型声明
│   └── main.ts                 # 入口文件
├── index.html                  # HTML 模板
├── vite.config.ts              # Vite 配置
├── tsconfig.json               # TypeScript 配置
├── tsconfig.node.json          # Node 环境 TS 配置
├── .eslintrc.cjs               # ESLint 配置
├── .eslintignore
├── .prettierrc.json            # Prettier 配置
├── .prettierignore
├── .gitignore
├── pnpm-lock.yaml
├── package.json
├── README.md
└── CLAUDE.md
```

## License

MIT
