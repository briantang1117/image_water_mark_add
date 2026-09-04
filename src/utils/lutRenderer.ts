import type { Lut3D, LutMode } from '@/types'

/**
 * Rec.709 显示信号编码的参考伽马（BT.1886 近似）。
 *
 * 若配方确为“真 Rec.709（视频显示信号）”输入（影视风格 LUT——即达芬奇里把
 * dlog 素材转成 Rec.709 之后直接套的那类），把 sRGB 图喂给它前必须先做一次重编码：
 * sRGB 显示值 → 线性光 → E' = L^(1/γ)（Rec.709 显示信号）。
 *
 * 达芬奇默认时间线为「Rec.709 Gamma 2.4」，故取 2.4。
 * 若你的达芬奇项目把 709 当 Gamma 2.2 处理，把此常量改为 2.2 即可。
 */
const REC709_DISPLAY_GAMMA = 2.4

/**
 * WebGL2 3D LUT 渲染器
 *
 * 双渲染管线：
 * - sRGB 直查（默认）：直接查表，与 Photoshop「颜色查找」层一致，适合多数风格化配方。
 * - Rec.709 还原（可选）：sRGB → 线性 → Rec.709 显示信号(BT.1886 参考) →
 *   查表 → 逆变换 → sRGB，还原达芬奇「dlog → Rec.709 → 套 LUT」的结果，用于真 Rec.709 输入配方。
 *
 * 利用 GPU 硬件 3D 纹理三线性插值，杜绝色彩断层。
 */
export class LutRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private imageTexture: WebGLTexture | null = null
  private lutTexture: WebGLTexture | null = null
  private currentLutSize = 0
  private maxTextureSize = 0
  /** P1-1：已上传源的引用缓存——同一图片/同一 LUT 实例不重复重建纹理 */
  private uploadedImageKey: unknown = null
  private uploadedLutKey: unknown = null
  private uImageLocation: WebGLUniformLocation | null = null
  private uLutLocation: WebGLUniformLocation | null = null
  private uLutSizeLocation: WebGLUniformLocation | null = null
  private uIntensityLocation: WebGLUniformLocation | null = null
  private uModeLocation: WebGLUniformLocation | null = null
  private uHasLutLocation: WebGLUniformLocation | null = null
  private uDomainMinLocation: WebGLUniformLocation | null = null
  private uDomainMaxLocation: WebGLUniformLocation | null = null
  /** P2-1：当前 LUT 的 DOMAIN_MIN/MAX（默认 0..1） */
  private lutDomainMin: [number, number, number] = [0, 0, 0]
  private lutDomainMax: [number, number, number] = [1, 1, 1]

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    })
    if (!gl) {
      throw new Error('当前浏览器不支持 WebGL2，无法使用 LUT 调色功能')
    }
    this.gl = gl
    // 纹理/画布尺寸上限，用于超限图片降采样（P0-2）
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    this.program = this.createProgram()
    this.vao = this.createFullscreenQuad()
    this.getUniformLocations()
  }

  // ===================== 着色器 =====================

  private readonly VERT_SRC = `#version 300 es
    in vec2 a_position;
    in vec2 a_uv;
    out vec2 v_uv;
    void main() {
      v_uv = a_uv;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `

  private readonly FRAG_SRC = `#version 300 es
    precision highp float;
    precision highp sampler3D;

    in vec2 v_uv;
    out vec4 outColor;

    uniform sampler2D u_image;
    uniform sampler3D u_lut;
    uniform float u_lutSize;
    uniform float u_intensity;   // 0.0 ~ 1.0
    uniform int u_mode;          // 0 = PS模式, 1 = 严谨模式
    uniform int u_hasLut;        // 0 = 无LUT, 1 = 有LUT
    uniform vec3 u_domainMin;    // LUT DOMAIN_MIN（默认 0）
    uniform vec3 u_domainMax;    // LUT DOMAIN_MAX（默认 1）

    // sRGB → 线性 (去掉 sRGB 伽马)
    vec3 srgbToLinear(vec3 c) {
      vec3 v = max(c, 0.0);
      bvec3 isLow = lessThanEqual(v, vec3(0.04045));
      vec3 linearLow = v / 12.92;
      vec3 linearHigh = pow((v + 0.055) / 1.055, vec3(2.4));
      return mix(linearHigh, linearLow, vec3(isLow));
    }

    // 线性 → sRGB (加上 sRGB 伽马)
    vec3 linearToSrgb(vec3 c) {
      vec3 v = max(c, 0.0);
      bvec3 isLow = lessThanEqual(v, vec3(0.0031308));
      vec3 srgbLow = v * 12.92;
      vec3 srgbHigh = 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055;
      return mix(srgbHigh, srgbLow, vec3(isLow));
    }

    // 线性光 → Rec.709 显示信号（BT.1886 参考近似：E' = L^(1/γ)）
    // 注意：这是“显示端”编码语义，不是 BT.709 摄像机 OETF(1.099/0.45) 捕获公式。
    vec3 linearToRec709(vec3 c) {
      return pow(max(c, 0.0), vec3(${1 / REC709_DISPLAY_GAMMA}));
    }

    // Rec.709 显示信号 → 线性光（上式的逆：L = E'^γ）
    vec3 rec709ToLinear(vec3 c) {
      return pow(max(c, 0.0), vec3(${REC709_DISPLAY_GAMMA}));
    }

    // 从 3D LUT 采样（三线性插值由 GPU 硬件完成）
    // uv 映射到 [0.5/size, 1 - 0.5/size] 以正确对齐 texel 中心
    vec3 sampleLut(vec3 rgb) {
      float s = u_lutSize;
      vec3 offset = vec3(0.5 / s);
      vec3 scale = vec3((s - 1.0) / s);
      vec3 uvw = rgb * scale + offset;
      // cube 文件顺序: R 变化最快 → u, G 中间 → v, B 变化最慢 → w
      return texture(u_lut, uvw).rgb;
    }

    // P2-1：把查表输入按 DOMAIN_MIN/MAX 归一到 [0,1]（0..1 domain 时为恒等）
    vec3 domainMap(vec3 c) {
      vec3 range = max(u_domainMax - u_domainMin, vec3(1e-6));
      return clamp((c - u_domainMin) / range, 0.0, 1.0);
    }

    void main() {
      vec4 texColor = texture(u_image, v_uv);
      vec3 src = texColor.rgb;  // 输入是 sRGB 编码

      if (u_hasLut == 0 || u_intensity <= 0.0) {
        outColor = texColor;
        return;
      }

      vec3 lutResult;

      if (u_mode == 0) {
        // ========== sRGB 直查模式（默认；对照 PS 颜色查找） ==========
        // 直接对 sRGB 编码像素查表，仅当配方确为 sRGB/PS 生态制作用。
        lutResult = sampleLut(domainMap(src));
      } else {
        // ========== Rec.709 还原模式（可选，真 Rec.709 输入配方用） ==========
        // sRGB → 线性 → Rec.709 显示信号 → LUT → Rec.709 显示信号 → 线性 → sRGB
        // 语义等价达芬奇「dlog → Rec.709 → 套 LUT」对同一画面（Rec.709 输入配方）。
        vec3 linear = srgbToLinear(src);
        vec3 rec709Sig = linearToRec709(linear);
        vec3 lutOut = sampleLut(domainMap(rec709Sig));
        vec3 lutLinear = rec709ToLinear(lutOut);
        lutResult = linearToSrgb(lutLinear);
      }

      // 浓度混合：输出 = 原图 × (1-浓度) + LUT结果 × 浓度
      vec3 finalColor = mix(src, lutResult, u_intensity);
      outColor = vec4(finalColor, texColor.a);
    }
  `

  // ===================== 初始化 =====================

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type)
    if (!shader) throw new Error('创建着色器失败')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader)
      throw new Error(`着色器编译失败: ${info}`)
    }
    return shader
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl
    const vs = this.createShader(gl.VERTEX_SHADER, this.VERT_SRC)
    const fs = this.createShader(gl.FRAGMENT_SHADER, this.FRAG_SRC)
    const program = gl.createProgram()
    if (!program) throw new Error('创建程序失败')
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program)
      throw new Error(`程序链接失败: ${info}`)
    }
    return program
  }

  private createFullscreenQuad(): WebGLVertexArrayObject {
    const gl = this.gl
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('创建 VAO 失败')
    gl.bindVertexArray(vao)

    // 两个三角形组成全屏四边形
    // 位置(x,y) + UV(u,v)
    const vertices = new Float32Array([
      // x,    y,    u,   v
      -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0,
    ])

    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

    const posLoc = gl.getAttribLocation(this.program, 'a_position')
    const uvLoc = gl.getAttribLocation(this.program, 'a_uv')

    const stride = 4 * 4 // 4 floats * 4 bytes
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(uvLoc)
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, stride, 2 * 4)

    gl.bindVertexArray(null)
    return vao
  }

  private getUniformLocations(): void {
    const gl = this.gl
    gl.useProgram(this.program)
    this.uImageLocation = gl.getUniformLocation(this.program, 'u_image')
    this.uLutLocation = gl.getUniformLocation(this.program, 'u_lut')
    this.uLutSizeLocation = gl.getUniformLocation(this.program, 'u_lutSize')
    this.uIntensityLocation = gl.getUniformLocation(this.program, 'u_intensity')
    this.uModeLocation = gl.getUniformLocation(this.program, 'u_mode')
    this.uHasLutLocation = gl.getUniformLocation(this.program, 'u_hasLut')
    this.uDomainMinLocation = gl.getUniformLocation(this.program, 'u_domainMin')
    this.uDomainMaxLocation = gl.getUniformLocation(this.program, 'u_domainMax')

    // 纹理单元绑定：image = 0, lut = 1
    gl.uniform1i(this.uImageLocation, 0)
    gl.uniform1i(this.uLutLocation, 1)
  }

  // ===================== 纹理上传 =====================

  /**
   * 上传图片到 2D 纹理（sRGB 格式）
   *
   * P1-1：按源对象幂等——同一 ImageItem（同一 img 引用）反复调用时跳过重建，
   * 拖浓度/切 LUT 只改 uniform + 重绘，不再整张重传，大幅降低 48MP 图的卡顿。
   * 切换图片时 img 引用变化，会自动真正重建。
   */
  uploadImage(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap): void {
    if (this.uploadedImageKey === img) return
    const gl = this.gl
    if (!this.imageTexture) {
      this.imageTexture = gl.createTexture()
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    // P0-2 + P2-3：先画进 Canvas2D 做统一处理——
    // ① 浏览器色彩管理把带 ICC(Display-P3/AdobeRGB) 的图归一到 sRGB 工作空间(与 Canvas2D 预览一致)；
    // ② 等比缩到 ≤ maxTextureSize，避免超限 texImage2D 静默失败。一次 draw 两件事。
    const src = this.prepareUploadSource(img)
    // 用 SRGB8_ALPHA8 内部格式，让 shader 中采样的值就是 sRGB 编码的
    // 这里我们用普通 RGBA，因为我们的 shader 自己管理伽马
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    this.assertNoGlError('图片纹理上传失败（可能超出 GPU 纹理上限）')
    // 像素已同步拷入 GPU 纹理，CPU 侧 canvas 不再需要，主动释放 backing store
    // （48MP 时这张 canvas ≈ 192MB，不释放会与后续 lutCanvas/outCanvas 峰值叠加）
    src.width = 0
    src.height = 0
    this.uploadedImageKey = img
  }

  /** 强制下一次 uploadImage 真正重建（当同一 ImageItem 的像素被替换时调用） */
  invalidateImage(): void {
    this.uploadedImageKey = null
  }

  /**
   * 归一上传源：始终画进一个 Canvas2D（浏览器默认 sRGB 工作空间），以该 canvas 作为纹理源。
   *
   * P2-3：WebGL 直接 texImage2D(<img>) 时，各浏览器对带 ICC 图片(Display-P3/AdobeRGB)的
   * 色彩管理不一致(可能拿到非 sRGB 原始值)；而 Canvas2D drawImage 会把图像色彩管理到 sRGB
   * 工作空间。统一经 canvas 上传，让 WebGL 采样值 = Canvas2D 预览/水印路径一致。
   * P0-2：顺带等比缩到 ≤ maxTextureSize，避免超限静默失败。
   */
  private prepareUploadSource(
    src: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  ): HTMLCanvasElement {
    const scale = Math.min(1, this.maxTextureSize / src.width, this.maxTextureSize / src.height)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(src.width * scale))
    c.height = Math.max(1, Math.round(src.height * scale))
    const ctx = c.getContext('2d')
    if (!ctx) {
      throw new Error('无法创建 Canvas2D 用于 LUT 图像处理')
    }
    ctx.drawImage(src, 0, 0, c.width, c.height)
    return c
  }

  /** 把宽高等比缩到 GPU 纹理/画布上限内（用于确定离屏渲染画布的安全尺寸） */
  getSafeCanvasSize(width: number, height: number): { width: number; height: number } {
    const max = this.maxTextureSize
    if (width <= max && height <= max) return { width, height }
    const scale = Math.min(max / width, max / height)
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    }
  }

  private assertNoGlError(context: string): void {
    const err = this.gl.getError()
    if (err !== this.gl.NO_ERROR) {
      throw new Error(`${context}（WebGL error 0x${err.toString(16)}）`)
    }
  }

  /**
   * 上传 3D LUT 数据到 3D 纹理
   */
  uploadLut(lut: Lut3D | null): void {
    const gl = this.gl
    if (!lut) {
      if (this.lutTexture) {
        gl.deleteTexture(this.lutTexture)
        this.lutTexture = null
      }
      this.currentLutSize = 0
      this.uploadedLutKey = null
      this.lutDomainMin = [0, 0, 0]
      this.lutDomainMax = [1, 1, 1]
      return
    }

    // P1-1：同一 LUT 实例（getLutData 有全局缓存）无需重复上传
    if (this.uploadedLutKey === lut) return

    if (!this.lutTexture) {
      this.lutTexture = gl.createTexture()
    }

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    // 3D 纹理数据：R 变化最快 → width, G 中间 → height, B 最慢 → depth
    // 与 data 布局一致：(b*size*size + g*size + r)*3 + channel
    const size = lut.size
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB16F, // 用浮点纹理保证精度
      size,
      size,
      size,
      0,
      gl.RGB,
      gl.FLOAT,
      lut.data,
    )
    this.assertNoGlError('3D LUT 纹理上传失败')
    this.uploadedLutKey = lut
    this.lutDomainMin = lut.domainMin
    this.lutDomainMax = lut.domainMax

    this.currentLutSize = size
  }

  // ===================== 渲染 =====================

  /**
   * 执行一次渲染
   * @param width  输出宽度
   * @param height 输出高度
   * @param intensity 浓度 0~1
   * @param mode 渲染模式
   */
  render(width: number, height: number, intensity: number, mode: LutMode): void {
    const gl = this.gl

    // 确保 canvas 尺寸匹配
    if (gl.canvas.width !== width || gl.canvas.height !== height) {
      gl.canvas.width = width
      gl.canvas.height = height
    }

    gl.viewport(0, 0, width, height)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)

    // 绑定图片纹理
    gl.activeTexture(gl.TEXTURE0)
    if (this.imageTexture) {
      gl.bindTexture(gl.TEXTURE_2D, this.imageTexture)
    }

    // 绑定 LUT 纹理
    gl.activeTexture(gl.TEXTURE1)
    if (this.lutTexture) {
      gl.bindTexture(gl.TEXTURE_3D, this.lutTexture)
    }

    // 设置 uniform
    gl.uniform1f(this.uLutSizeLocation, this.currentLutSize)
    gl.uniform1f(this.uIntensityLocation, intensity)
    gl.uniform1i(this.uModeLocation, mode === 'professional' ? 1 : 0)
    gl.uniform1i(this.uHasLutLocation, this.lutTexture ? 1 : 0)
    gl.uniform3fv(this.uDomainMinLocation, this.lutDomainMin)
    gl.uniform3fv(this.uDomainMaxLocation, this.lutDomainMax)

    // 绘制
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    gl.bindVertexArray(null)
  }

  /**
   * 销毁资源
   */
  destroy(): void {
    const gl = this.gl
    if (this.imageTexture) gl.deleteTexture(this.imageTexture)
    if (this.lutTexture) gl.deleteTexture(this.lutTexture)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
  }
}

let _webgl2Supported: boolean | null = null

/**
 * 检测当前环境是否支持 WebGL2（结果缓存）
 * 避免每次导出/预览都新建 WebGL 上下文（Safari 等对活跃/历史 context 数量有限制）
 */
export function isWebGL2Supported(): boolean {
  if (_webgl2Supported === null) {
    try {
      const canvas = document.createElement('canvas')
      _webgl2Supported = !!canvas.getContext('webgl2')
    } catch {
      _webgl2Supported = false
    }
  }
  return _webgl2Supported
}
