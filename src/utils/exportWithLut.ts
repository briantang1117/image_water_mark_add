import { LutRenderer, isWebGL2Supported } from './lutRenderer'
import { drawWatermark, injectExifToJpeg } from './index'
import type { Lut3D, LutMode } from '@/types'

/**
 * 合成导出参数
 */
export interface ExportOptions {
  /** 原图 */
  img: HTMLImageElement
  /** 原始文件 buffer（用于写回 EXIF） */
  originalBuffer?: ArrayBuffer
  /** LUT 数据（null 表示不应用 LUT） */
  lut: Lut3D | null
  /** LUT 浓度 0~1 */
  intensity: number
  /** LUT 渲染模式 */
  lutMode: LutMode
  /** 水印图片（null 表示不绘制水印） */
  watermarkImg: HTMLImageElement | null
  /** 水印混合模式 */
  blendMode: string
  /** 水印适配模式 */
  fitMode: string
  /** 水印不透明度 0~100 */
  opacity: number
  /** 水印缩放 0~200 */
  scale: number
  /** 水印 X 位置 0~100 */
  posX: number
  /** 水印 Y 位置 0~100 */
  posY: number
  /** 导出格式 */
  format: 'jpeg' | 'png'
  /** JPEG 质量 0~1 */
  quality: number
}

/**
 * 合成 LUT + 水印，导出为 Blob
 *
 * 渲染顺序：原图 → LUT 调色 → 水印叠加
 * 水印不参与 LUT 调色，保证水印颜色准确
 */
export async function exportComposedBlob(
  opts: ExportOptions,
): Promise<{ blob: Blob; ext: string }> {
  const {
    img,
    originalBuffer,
    lut,
    intensity,
    lutMode,
    watermarkImg,
    blendMode,
    fitMode,
    opacity,
    scale,
    posX,
    posY,
    format,
    quality,
  } = opts

  const w = img.width
  const h = img.height

  // === 第一步：WebGL 渲染 LUT 效果 ===
  let lutCanvas: HTMLCanvasElement

  if (lut && intensity > 0) {
    // P0-1：不允许“选了 LUT 却静默导出原图”——能力缺失时明确抛错，由调用方展示给用户
    if (!isWebGL2Supported()) {
      throw new Error(
        'LUT 调色需要 WebGL2，当前浏览器不支持；请使用新版浏览器，或先移除 LUT 再导出',
      )
    }
    const glCanvas = document.createElement('canvas')
    const renderer = new LutRenderer(glCanvas)
    try {
      // P0-2：超 GPU 纹理上限时用安全尺寸渲染（等比缩到上限内），回贴时拉伸回原尺寸
      const safe = renderer.getSafeCanvasSize(w, h)
      glCanvas.width = safe.width
      glCanvas.height = safe.height
      renderer.uploadImage(img)
      renderer.uploadLut(lut)
      renderer.render(safe.width, safe.height, intensity, lutMode)
      lutCanvas = glCanvas
    } finally {
      renderer.destroy()
    }
  } else {
    // 无 LUT 或强度为 0：直接用原图
    const tmp = document.createElement('canvas')
    tmp.width = w
    tmp.height = h
    const ctx = tmp.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    lutCanvas = tmp
  }

  // === 第二步：Canvas2D 叠加水印 ===
  const outCanvas = document.createElement('canvas')
  outCanvas.width = w
  outCanvas.height = h
  const ctx = outCanvas.getContext('2d')!

  // JPG 铺白底
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
  }

  // 画 LUT 后的底图（lutCanvas 可能因超限为缩小尺寸，这里拉伸到原尺寸）
  ctx.drawImage(lutCanvas, 0, 0, w, h)

  // 画水印
  if (watermarkImg) {
    ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
    ctx.globalAlpha = opacity / 100
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    drawWatermark(ctx, watermarkImg, w, h, fitMode, scale, posX, posY)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  // === 第三步：导出为 Blob ===
  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas toBlob 失败'))),
      mimeType,
      format === 'jpeg' ? quality : undefined,
    )
  })

  const ext = format === 'png' ? 'png' : 'jpg'

  // JPEG：写回 EXIF
  if (format === 'jpeg' && originalBuffer) {
    const finalBlob = await injectExifToJpeg(blob, originalBuffer)
    return { blob: finalBlob, ext }
  }

  return { blob, ext }
}
