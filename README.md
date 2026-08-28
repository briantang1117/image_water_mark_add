# DJI 水印叠加工具（批量版）

一个纯前端的图片批量水印叠加工具，支持多种水印样式、混合模式、位置/大小调节，可单张下载或批量打包为 ZIP。

## 功能特性

- 🖼️ **批量处理**：一次选择多张图片，批量添加水印并打包下载
- 🎨 **多种水印**：内置 4 种水印（DJI OP4P 横/竖屏、索尼 A7C 横/竖屏）
- 🔧 **灵活调节**：不透明度、大小、X/Y 位置自由调整
- 🎭 **混合模式**：Screen 滤色、Lighten 增亮、Soft-Light 柔光、Multiply 正片叠底、正常叠加
- 📐 **适配模式**：Contain 完整显示、Cover 铺满裁切、Original 原始尺寸
- 💾 **导出格式**：JPG / PNG，JPG 质量可调
- 📱 **移动端兼容**：可嵌入 iOS WKWebView，支持原生相册选择与保存

## 快速开始

项目是纯静态页面，无需构建：

```bash
# 方式一：直接用浏览器打开 index.html

# 方式二：启动本地静态服务器
python3 -m http.server 8000
# 然后访问 http://localhost:8000
```

## 使用说明

1. 点击 **「选择多张图片」** 上传需要加水印的照片
2. 在左侧缩略图列表中选择要预览的图片
3. 在顶部工具栏中选择水印样式、混合模式，调整不透明度、大小、位置
4. 点击 **「下载当前图片」** 保存单张，或 **「下载全部 (ZIP)」** 批量打包下载

## 技术说明

- **纯前端**：所有处理在浏览器本地完成，图片不会上传到服务器
- **Canvas 渲染**：使用 HTML5 Canvas 2D API 进行图像合成
- **JSZip**：通过 CDN 加载，用于批量导出 ZIP 压缩包
- **原生桥接**：检测到 iOS WKWebView 环境时，通过 `window.webkit.messageHandlers.native` 与原生代码交互

### 混合模式说明

- **Screen 滤色**（默认）：适用于黑底水印，黑色区域会变透明
- **Lighten 增亮**：只提亮暗部区域
- **Soft-Light 柔光**：柔和叠加效果
- **Multiply 正片叠底**：适用于白底水印
- **正常叠加**：直接覆盖

## 项目结构

```
dji-water/
├── index.html          # 主应用（HTML + CSS + JS 单文件）
├── assets/             # 水印图片资源
│   ├── op4p_horizontal.png
│   ├── op4p_vertical.png
│   ├── a7c_horizontal.png
│   └── a7c_vertical.png
└── CLAUDE.md           # Claude Code 项目文档
```

## License

MIT
