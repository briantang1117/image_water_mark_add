# LUT 调色链路整改方案(代码 Review 后)

> 配套文档:[《Web端 3D LUT(Cube)图片调色工具 完整技术方案文档》](./Web端%203D%20LUT(Cube)图片调色工具%20完整技术方案文档.md)
> 性质:整改方案。已落地的条目在对应章节标注 ✅,最新进度见文末「9. 变更记录」。

---

## 0. 结论摘要(先给结论)

代码 Review 对 `cubeParser / lutRenderer / exportWithLut / useLut / constants/luts` 及预览导出链路的判定:

- **主链路正确且自洽**:cube 解析行序 → `Float32Array` 布局 → `texImage3D`(R→width)→ GPU 三线性插值 → texel 中心对齐(`uvw = rgb·(S-1)/S + 0.5/S`)、`CLAMP_TO_EDGE + LINEAR`、半浮点 `RGB16F` 纹理,这些选型都对。
- **预览与导出共用同一 `LutRenderer`、同一份 per-image mode/intensity 数据 → 所见即所得已闭环**,这是本实现最扎实的一点。
- **真正要修的是 4 类工程问题 + 1 个行业顺序坑**,不是调色算法本身。按严重度分级如下。

### 问题总览

| 编号 | 严重度 | 问题 | 一句话本质 | 建议 |
|---|---|---|---|---|
| P0-1 ✅ | 🔴 | WebGL2 不可用时**静默降级成原图** | 用户选了 LUT,导出/预览却拿到没调色的图,仅 `console.warn` | 禁止静默降级;LUT 面板置灰 + 导出直接报错 |
| P0-2 ✅ | 🔴 | 超 `MAX_TEXTURE_SIZE` 时纹理上传失败被吞 | 高像素航拍/拼接图可能全黑或输出旧帧,无任何提示 | 查询上限;超限走"分块渲染"或"降采样渲染" |
| P1-1 ✅ | 🟠 | 预览每次重渲都全量重传图片纹理 | 拖浓度/切 LUT 都重传整张原图,48MP 明显卡 | upload/render 幂等,按源引用缓存 |
| P1-2 ✅ | 🟠 | `cubeParser` 内置 LUT 生成函数是死代码 | `createWarm/Cool/Contrast/Film/Neutral/getBuiltinLuts` 零引用 | 已删除(2026-09-03) |
| P1-3 ⏸ | 🟠 | cube 行序坑(内置 R-fastest,已核实自洽) | 行业存在 R-fastest 与 B-fastest 两派;未来换配方包会**静默整盘错色** | 决策:不开放用户导入、配方仅内置 → 不构成风险,**不实施**(见 §5) |
| P2-1 | 🟡 | `DOMAIN_MIN/MAX` 解析后未参与计算 | 规范允许非 0..1 定义域,当前一律忽略 | 可选:查表前做 domain 归一 |
| P2-2 ✅ | 🟡 | Rec.709 语义与默认模式 | 原为摄像机 OETF 语义、默认 PS;按"内置配方=真 Rec.709 输入"决策修正 | 已落地:BT.1886 显示信号 γ2.4 + 默认 Rec.709,见 §6.2 |
| P2-3 | 🟡 | 解码色彩空间差异未验证 | WebGL `texImage2D` 对带 ICC 图片的 CMS 处理各浏览器不统一 | 低成本归一:上传前先过一遍 sRGB 工作空间 canvas |

> 其中 P1-3 与 P2-3 是"认知风险",其余是"确定性缺陷"。本文把确定缺陷按 P0/P1/P2 给完整落地方案,认知风险给出护栏方案。
> **P0-1、P0-2、P1-1、P1-2 已于 2026-09-03 落地;P1-3 决策不实施**,见各节「实施记录」与文末「9. 变更记录」。

---

## 1. P0-1:WebGL2 不可用时,禁止静默降级

### 1.1 现状

- `PreviewPanel.renderLutToOffscreen()`(`src/components/PreviewPanel.vue:82-91`):`!lutRenderer || !webglSupported` 时临时建 canvas 画原图,当底图。
- `exportWithLut.exportComposedBlob()`(`src/utils/exportWithLut.ts:69-90`):`lut && intensity>0 && isWebGL2Supported()` 为假时,直接 `drawImage` 原图导出。
- 两处只在 console 打一行 warn,用户完全无感知。

### 1.2 本质问题

"用户明确选了 LUT" 与 "没有 LUT" 是两个语义,当前实现把前者**坍缩**成后者。对批量出图工具这是数据保真事故(钱和精力花在选配方上,产物却没有效果)。

### 1.3 方案(收敛到一处判断,双端共用)

新增工具,把"LUT 是否真的可用"收敛成一个事实来源:

```ts
// src/utils/lutRenderer.ts (新增导出)
export type LutCapability =
  | { ok: true }
  | { ok: false; reason: 'no-webgl2' }
  | { ok: false; reason: 'unsupported-image' } // 预留:P0-2 超限等
export function getLutCapability(): LutCapability { ... }
```

- **预览端**(`PreviewPanel.vue`):初始化失败时不再回退原图底图,而是:
  - 画面上方显示常驻提示条「当前浏览器不支持 WebGL2,LUT 调色不可用」;
  - 正常显示图片与"原图/效果图"切换按钮(此时效果图 = 原图),但**提示语必须出现**,不让用户误以为已套配方。
- **导出端**(`exportWithLut.ts`):`opts.lut` 非空且 `intensity > 0` 时:
  - WebGL2 可用 → 走正常 LUT 分支;
  - 不可用 → **不静默回退**,`reject(new Error('LUT 需要 WebGL2,当前浏览器不支持,请勿在未套 LUT 的状态下导出'))`,由调用方(`HomeView.vue` 导出流程)统一弹窗/toast。
  - 仅当 `lut == null`(用户确实没选 LUT)时才允许走"原图直接导出"路径。
- **UI 层**(`LutPanel.vue` / `HomeView.vue`):批量导出前遍历当前要导出的图片,凡 `lutId` 非空者做一次能力检查;不支持时在确认弹窗里明确告知,提供"仍导出(不套 LUT)"与"取消"两个选项,把选择权交还用户。

### 1.4 验收

1. 在禁 WebGL2 的环境(或 `Safari` 开发者工具里关闭 GPU / 临时把 `isWebGL2Supported` 打桩为 false):
   - 预览出现明确提示条;
   - 带 LUT 的导出必须弹错误/确认框,绝不静默产出原图;
   - 不带 LUT 的导出行为不变。
2. 正常环境回归:原截图行为零变化。

### 1.5 ✅ 实施记录(2026-09-03)

- `lutRenderer.ts`:`isWebGL2Supported()` 改为**带缓存**(避免每次导出/预览反复新建 WebGL context)。
- `PreviewPanel.vue`:`webglSupported` 变量改为响应式 `lutUnavailable` / `downscaledNotice` 两个 ref;`initRenderer` 失败置 `lutUnavailable`;`renderLutToOffscreen` **仅当真正需要套 LUT(有 LUT 且浓度>0)才走 WebGL**,无 LUT / 不可用时回原图;顶部显示两条横幅(lutUnavailable / downscaledNotice)。
- `LutPanel.vue`:`const lutSupported = isWebGL2Supported()`,不支持时**禁用全部 LUT 控件 + 顶部警示条**。
- `exportWithLut.ts`:带 LUT(`lut && intensity>0`)但 WebGL2 不可用时 **直接 throw**,不再静默回退原图。
- `HomeView.vue`:**无需改动**——现有 `try/catch` 已把 `e.message` 显示到页面 status(单张/批量都会中止并提示原因)。
- 与原方案差异:未做"批量导出前弹确认框(仍导出/取消)",改为**遇带 LUT 且不支持即报错中止并显示原因**(语义等价、实现更简);未引入 `getLutCapability` 类型,统一复用缓存版 `isWebGL2Supported()`。

---

## 2. P0-2:超纹理上限防护

### 2.1 现状

`uploadImage`(`lutRenderer.ts:231-246`)与 `uploadLut`(`lutRenderer.ts:277-288`)直接把 `img` 原尺寸 `texImage2D/3D`,不读取 `gl.MAX_TEXTURE_SIZE`。DJI 设备照片常见 48MP(约 8064×6048,多数设备上限 8192 能过),但**全景拼接、更高像素机型**一旦超过上限,上传报错被吞,纹理不完整 → 采样黑/旧帧,预览导出同时出错且无提示。

### 2.2 方案

在 `LutRenderer` 构造时查询并缓存上限,上传前做尺寸门卫:

```ts
this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) // 通常 4096/8192/16384
```

超限时二选一(按复杂度递进):

1. **降采样渲染(短期,1 天)**
   - WebGL 只处理一张 ≤ 上限的等比缩图(LUT 是低频全局映射,降采样损失可接受);
   - 预览:直接把缩图结果铺到显示 canvas;
   - 导出:输出画布仍是原图尺寸——先 `drawImage` 把原图铺底,再把 WebGL 缩图结果 `drawImage` 放大覆盖(顶多边缘轻微不一致),水印仍在原尺寸域绘制。
   - 限制:极端超大图放大后局部可能有轻微走样。需要在导出时对"超限已降采样"给一次性提示。
2. **分块渲染(推荐长期)**
   - 把原图按 `< 上限/2` 切块,每块独立 upload + render 到各自的离屏 canvas,再按坐标 `drawImage` 拼回输出画布;
   - 正确性最好,但实现量约 1.5~2 天。适合批量高像素出图是主场景时选。

另外**无论哪种**,`texImage2D` / `texImage3D` 之后补一次 `gl.getError()`,非 `NO_ERROR` 就抛可读错误(链路里现在到处吞错误,这是总病根)。可顺带加 `LutRenderer` 的 `render` 返回值 `boolean` 表示本次是否真正画了 LUT。

### 2.3 验收

- 造一张 > 上限的测试图(如用现有 `TestPatternView` 可先导出 3840×2160,再用工具放大),验证:预览不黑屏、导出有 LUT 效果、有明确降采样提示。
- 普通 ≤ 上限图片回归:像素级行为与改动前一致(可用 DiffView 对照)。

### 2.4 ✅ 实施记录(2026-09-03)

- `lutRenderer.ts`:构造时读取 `gl.MAX_TEXTURE_SIZE` 存 `maxTextureSize`;新增 `clampSourceToMax`(上传源等比缩到上限内)、`getSafeCanvasSize`(返回安全渲染尺寸)、`assertNoGlError`(`texImage2D/3D` 后检查 `gl.getError()`,失败抛可读错误)。
- `PreviewPanel.vue`:`renderLutToOffscreen` 用 `getSafeCanvasSize` 作为渲染画布尺寸;`render` / `refreshWatermark` 回贴时 `drawImage(..., 0, 0, width, height)` 拉伸回原尺寸;超限时置 `downscaledNotice` 显示横幅。
- `exportWithLut.ts`:离屏 canvas 改为安全尺寸渲染,再拉伸到原尺寸导出;上传仍由 `clampSourceToMax` 双保险。
- 采用**降采样渲染**路线;**分块渲染未做**(排期)。原图 ≤ 上限场景像素级行为不变。

### 3.1 现状

`PreviewPanel.renderLutToOffscreen()`(`PreviewPanel.vue:94-96`)每次渲染都执行:

```ts
lutRenderer.uploadImage(img)   // 整张原图重建纹理
const lut = getCurrentLut()
lutRenderer.uploadLut(lut)     // LUT 数据重建(带缓存,轻)
```

拖浓度滑块、切 LUT、切模式都会触发 `render()` → 每次全量重传图片纹理。48MP 原图一次上传约 190MB+ 显存带宽,交互明显卡顿。

### 3.2 方案

在 `LutRenderer` 内部按"源对象是否变化"做缓存,把 upload 与 draw 分离成两个方法:

```ts
uploadImageIfChanged(src: HTMLImageElement | HTMLCanvasElement): boolean
// ↑ 记录 lastImageSource;引用相同(同一 ImageItem 反复渲染)则跳过上传,直接复用旧纹理
//   切图时换新引用,才真正重建纹理
```

配合调用端语义:

- 预览侧:图片切换 → `uploadImageIfChanged`(真正重建);LUT/强度/模式变化 → 只改 uniform + `render`,不再重传图。
- `getLutData()` 已有全局缓存(`constants/luts.ts:25`),LUT 侧数据本就只解析一次;代价在图片纹理重建。

> 注意:同一 `ImageItem` 内部如果像素后来变了(本项目没有此场景,图片加载即定),可加一个显式 `invalidateImage()` 兜底,防缓存错用。

### 3.3 验收

- 拖浓度滑块时肉眼帧率明显提升(可开 Performance 面板看 `uploadImage` 不再高频出现)。
- 反复切图后再切回,显示内容仍正确(无旧纹理残留)。

### 3.4 ✅ 实施记录(2026-09-03)

- `lutRenderer.ts`:`uploadImage` / `uploadLut` 改为**按源对象幂等**——新增 `uploadedImageKey` / `uploadedLutKey` 字段,同一 `ImageItem`(同一 img 引用)或同一 LUT 实例(`getLutData` 全局缓存)反复调用时直接跳过重建;切图时引用变化自动真正重建。另新增 `invalidateImage()` 供像素被替换时强制重传。
- `PreviewPanel.vue` 无需改动:原有每次 `render()` 调 `uploadImage` 的路径,命中幂等即跳过。
- 与原方案差异:实现为"幂等 `uploadImage`"而非独立 `uploadImageIfChanged` 方法(语义等价、API 更小);LUT 纹理同样加了幂等缓存。
- 验收:拖浓度滑块时帧率明显提升;切图/切回内容正确。

---

## 4. P1-2:清理 cubeParser 死代码

### 4.1 现状

`src/utils/cubeParser.ts:120-255` 中 `createNeutralLut`、`generateLut`、`createWarmLut/CoolLut/Contrast/Film`、`getBuiltinLuts` **零引用**(已 grep 确认)。`constants/luts.ts` 只走 `import.meta.glob('@/assets/luts/*/*.cube')`,内置配方在代码里,入口却在文件 glob 里——两套机制,维护者会困惑"内置配方该加在哪"。

### 4.2 方案(建议删除路径,零功能损失)

- 删除 `cubeParser.ts` 中上述未引用函数,保留 `parseCubeFile / parseCubeFileFromFile`。
- 若确实想保留"中性/暖阳/冷调/高对比/胶片"这几档:**把它们做成 `src/assets/luts/builtin/*.cube` 真实文件**,让现有 glob + 懒解析 + 分类机制统一接管,不需要任何代码分支。

### 4.3 验收

- `grep -rn "getBuiltinLuts|createWarmLut|createNeutralLut" src` 应清空(允许仅出现在文档/测试)。
- `pnpm build` 通过(noUnusedLocals 之下,未引用的顶层导出其实不报错,故需以 grep 验收而非仅靠编译器)。

### 4.4 ✅ 实施记录(2026-09-03)

- `cubeParser.ts` 截断至 115 行:删除 `createNeutralLut / generateLut / createWarm/Cool/Contrast/Film / getBuiltinLuts / ColorTransform`,保留 `parseCubeFile / parseCubeFileFromFile`。已 grep 确认无残留、`pnpm build` 通过。
- 未新增 `assets/luts/builtin/*.cube`(无内置配方需求)。

---

## 5. P1-3:cube 行序坑 —— 护栏与自检(2026-09-03 决策:不实施)

### 5.1 背景(为什么是坑)

`.cube` 行序行业**两派并存**:

- 你们的内置文件经结构验证是 **R-fastest**(首块沿 R 从 0.018→0.88 平滑爬升;若按 B-fastest 解释则意味着"纯蓝输入 0→1 让 R 飙到 0.88、B 几乎不动",不合常理)——**与 `cubeParser`/`uploadLut` 假设一致,内置场景正确**;
- 但 Adobe 官方 Cube LUT Spec 1.0(Chromium/QCMS 源码注释明确引用)定义 **B-fastest / R-slowest**,DaVinci/部分工具导出也走另一派。

→ 只要素材源是"自己这批包",永远没问题;一旦**开放用户导入 .cube 或替换配方包**,行序不符会**静默整盘错色,连报错都没有**。

### 5.2 方案

- **立即(文档化)**:在 `README` / 现有技术方案文档补一句「内置配方均为 R-fastest(R 最内层递增),配套解析器按此约定;导入他源 cube 前需核对行序」。
- **护栏(若开放导入)**:`parseCubeFile` 增加可选 `channelOrder` 参数,提供 `'rgb-fast'(当前)| 'bgr-fast' | 'auto'`;`auto` 用小型启发式(读取前 S 个点的输出结构判断哪条轴在平滑爬升)并在 UI 提供显式选择 + 预览结果,把猜测权交回用户。
- **固化自检**:你们已有 `TestPatternView`(R/G/B 单通道渐变)与 `DiffView`(ΔE2000)。沉淀一条回归 SOP:
  1. TestPattern 导出 R-only 渐变图;
  2. 工具内套某内置配方 → 导出;
  3. Photoshop 对同图应用同 `.cube` → 导出;
  4. DiffView 对比,ΔE 应整体极低(灰阶/红轴区域无系统性偏移)。
  - 该 SOP 同时验证"行序正确 + 渲染管线像素级对齐 PS",是当前唯一能一锤定音证明调色实现正确的证据,建议沉淀成文档或脚本。

> **2026-09-03 决策:** 未来**不开放用户导入 .cube,配方仅内置**——行序一致性问题不构成实际风险,本项(含 auto 检测、UI 顺序选项)**不实施**。仅需保留认知:内置文件均为 R-fastest,配套解析器按此约定,将来若改变策略再启用护栏。

---

## 6. P2 项(可选)

### 6.1 P2-1:DOMAIN_MIN/MAX 参与计算

`cubeParser.ts:49-65` 已解析并存储 domain,但渲染端 `sampleLut`(`lutRenderer.ts:105-112`)直接按 [0,1] 输入。内置文件均为 0..1,无影响。若支持他源 cube:查表前先 `(src - domainMin)/(domainMax - domainMin)` 归一,越界 clamp。属"不做也不出事,做了更规范",排期宽松时再做。

### 6.2 Rec.709 语义与默认模式(已落地 2026-09-03)

经确认:内置配方(卷系等)为**"真 Rec.709(视频显示信号)"输入**——即达芬奇里把 dlog 素材转成 Rec.709 之后再套的那类 LUT。据此:

- **默认渲染模式改为 Rec.709 还原**,不再默认 sRGB 直查;**不引入 per-LUT inputEncoding 标注**(所有 LUT 默认按真 Rec.709 输入处理)。
- Rec.709 段编码从「BT.709 摄像机 OETF(0.018/4.5/1.099·^0.45)」修正为「**BT.1886 参考显示信号,纯幂律 γ=2.4**」:
  `sRGB → 线性 → E'=L^(1/2.4) → LUT 查表 → L=E'^2.4 → sRGB`。
  达芬奇默认 timeline 即「Rec.709 Gamma 2.4」;若项目按 Gamma 2.2 处理,改 `lutRenderer.ts` 顶部 `REC709_DISPLAY_GAMMA = 2.4` 为 `2.2` 一行即可。
- sRGB 直查(`ps`)保留为**手动对照项**(对应 Photoshop「颜色查找」),入口在 `LutPanel` 的「sRGB 直查」。
- 涉及文件:`lutRenderer.ts`(shader 语义 + γ 常量)、`useLut.ts` / `useWatermark.ts`(默认 mode)、`LutPanel.vue`(UI 顺序/文案)、`types/index.ts`(注释)。

### 6.3 P2-3:解码色彩空间一致性验证

若目标是"与 PS/Lightroom 一致",最大偏差源常不是 LUT 而是 **WebGL 上传路径对带 ICC 图片的 CMS 处理在浏览器间不一致**(`texImage2D` 与 canvas `drawImage` 行为不同)。

低成本归一手段(推荐做一次验证):

- 上传前先把 `<img>` 画到一个 Canvas2D(`canvas` 走浏览器 sRGB 工作空间、会做 CMS 转换),再以该 canvas 作为纹理源;
- 用带 Display-P3 / AdobeRGB ICC 的实测图,在 Safari/Chrome 分别导出,与 PS 对照 DiffView,记录是否有系统性偏色;
- 若确认归一有效,即把 `uploadImage` 的入参统一为"sRGB 工作空间的 canvas",消除跨浏览器差异。

---

## 7. 建议改造的落地顺序(含工作量粗估)

| 顺序 | 任务 | 主要改动文件 | 工作量 |
|---|---|---|---|
| 1 | ✅ P0-1 WebGL2 不可用禁止静默降级(2026-09-03) | `lutRenderer.ts`、`PreviewPanel.vue`、`LutPanel.vue`、`exportWithLut.ts` | 已落地 |
| 2 | ✅ P0-2 超纹理上限 · 降采样(2026-09-03;分块未做,排期) | `lutRenderer.ts`、`PreviewPanel.vue`、`exportWithLut.ts` | 已落地(降采样) |
| 3 | ✅ P1-1 预览纹理上传缓存(2026-09-03) | `lutRenderer.ts`(幂等 upload/uploadLut + `invalidateImage`) | 已落地 |
| 4 | ✅ P1-2 清理 cubeParser 死代码(2026-09-03) | `cubeParser.ts` | 已落地 |
| 5 | ⏸ P1-3 顺序护栏 + 回归 SOP(2026-09-03 决策:不开放导入) | — | 不实施 |
| 6 | P2 项 | 按需 | 弹性 |

> 前 4 项互不依赖、可按任意顺序;建议 1、2 先做(数据保真优先),3 随手,4 顺手清。

---

## 8. 明确不做(防止范围蔓延)

- ❌ 不推翻双渲染管线设计。默认模式为 **Rec.709 还原**(内置配方按真 Rec.709 输入,sRGB 直查保留为手动对照),色彩科学见 §6.2 与配套技术方案文档。
- ❌ 不做 CPU 端 LUT 软件回退作为 WebGL2 缺失的补位方案(与 P0-1 的"禁止静默降级"冲突,且引入双实现不一致风险)。
- ❌ 不引入第三方 LUT 库(ocio.js 等)去"自动判断行序/色彩空间"——对纯前端单页工具收益 < 成本,护栏 + 自检已够。
- ❌ 本轮不改水印链路(LUT 与 Canvas2D 水印叠加顺序、EXIF 写回均已被确认合理)。

---

## 9. 变更记录

| 日期 | 变更 | 说明 |
|---|---|---|
| 2026-09-03 | Rec.709 语义修正 + 默认切 Rec.709 | 内置配方默认按真 Rec.709(视频显示信号)输入;Rec.709 段编码改为 BT.1886 纯幂律 γ=2.4;`REC709_DISPLAY_GAMMA` 可一键切 2.2。文件:`lutRenderer.ts / useLut.ts / useWatermark.ts / LutPanel.vue / types/index.ts` |
| 2026-09-03 | P0-1:禁止 WebGL2 缺失时静默降级 | 预览横幅 + LUT 面板置灰 + 带 LUT 导出直接报错。见 §1.5 |
| 2026-09-03 | P0-2:超纹理上限降采样 + 上传错误暴露 | 读 `MAX_TEXTURE_SIZE`,安全尺寸渲染/降采样上传,`gl.getError` 兜底。分块渲染待排期。见 §2.4 |
| 2026-09-03 | P1-1 预览纹理上传缓存 | `uploadImage/uploadLut` 按源引用幂等 + `invalidateImage()`;拖浓度/切 LUT 不再重传整图。见 §3.4 |
| 2026-09-03 | P1-2 清理 cubeParser 死代码 | 删除未引用的内置 LUT 生成函数,文件 255→115 行。见 §4.4 |
| 2026-09-03 | P1-3 决策:不开放用户导入 | 配方仅内置,行序不构成风险;护栏与回归 SOP **不实施**,仅保留 R-fastest 约定说明。见 §5 |
