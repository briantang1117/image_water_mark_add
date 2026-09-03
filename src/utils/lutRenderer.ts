import type { Lut3D, LutMode } from '@/types'

/**
 * WebGL2 3D LUT 渲染器
 *
 * 支持双渲染管线：
 * - PS 兼容模式：sRGB 直接查表（与 Photoshop 颜色查找层一致）
 * - 严谨专业模式：sRGB ↔ Rec.709 伽马转换后查表（对齐 DaVinci Resolve）
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
  private uImageLocation: WebGLUniformLocation | null = null
  private uLutLocation: WebGLUniformLocation | null = null
  private uLutSizeLocation: WebGLUniformLocation | null = null
  private uIntensityLocation: WebGLUniformLocation | null = null
  private uModeLocation: WebGLUniformLocation | null = null
  private uHasLutLocation: WebGLUniformLocation | null = null

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

    // 线性 → Rec.709 伽马 (ITU-R BT.709 标准 OETF 分段公式)
    vec3 linearToRec709(vec3 c) {
      vec3 v = max(c, 0.0);
      bvec3 isLow = lessThanEqual(v, vec3(0.018));
      vec3 low = v * 4.5;
      vec3 high = 1.099 * pow(v, vec3(0.45)) - 0.099;
      return mix(high, low, vec3(isLow));
    }

    // Rec.709 伽马 → 线性 (ITU-R BT.709 标准反向分段公式)
    vec3 rec709ToLinear(vec3 c) {
      vec3 v = max(c, 0.0);
      bvec3 isLow = lessThanEqual(v, vec3(0.081));
      vec3 low = v / 4.5;
      vec3 high = pow((v + 0.099) / 1.099, vec3(1.0 / 0.45));
      return mix(high, low, vec3(isLow));
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

    void main() {
      vec4 texColor = texture(u_image, v_uv);
      vec3 src = texColor.rgb;  // 输入是 sRGB 编码

      if (u_hasLut == 0 || u_intensity <= 0.0) {
        outColor = texColor;
        return;
      }

      vec3 lutResult;

      if (u_mode == 0) {
        // ========== PS 兼容模式 ==========
        // sRGB 直接查表（与 Photoshop 颜色查找层行为一致）
        lutResult = sampleLut(clamp(src, 0.0, 1.0));
      } else {
        // ========== 严谨专业模式 ==========
        // sRGB → 线性 → Rec.709 伽马 → LUT → Rec.709 伽马 → 线性 → sRGB
        vec3 linear = srgbToLinear(src);
        vec3 rec709Gamma = linearToRec709(linear);
        vec3 lutOut = sampleLut(clamp(rec709Gamma, 0.0, 1.0));
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
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
      -1,  1, 0, 0,
       1, -1, 1, 1,
       1,  1, 1, 0,
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

    // 纹理单元绑定：image = 0, lut = 1
    gl.uniform1i(this.uImageLocation, 0)
    gl.uniform1i(this.uLutLocation, 1)
  }

  // ===================== 纹理上传 =====================

  /**
   * 上传图片到 2D 纹理（sRGB 格式）
   */
  uploadImage(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap): void {
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

    // 用 SRGB8_ALPHA8 内部格式，让 shader 中采样的值就是 sRGB 编码的
    // 这里我们用普通 RGBA，因为我们的 shader 自己管理伽马
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
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
      return
    }

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

/**
 * 检测当前环境是否支持 WebGL2
 */
export function isWebGL2Supported(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    return !!gl
  } catch {
    return false
  }
}
