import exifr from 'exifr'
import type { ExifInfo } from '@/types'
import { BRANDS } from '@/constants'

/**
 * 判断是否运行在原生 app 内 (iOS WKWebView)
 */
export function isNativeApp(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.native
  )
}

/**
 * 判断是否 iOS 设备（Safari / WKWebView）
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ 伪装成 Mac，但有触控
    (navigator.platform === 'MacIntel' && 'ontouchend' in document)
  )
}

/**
 * 通用文件下载：兼容 iOS Safari
 * - 优先用 <a download> + ObjectURL
 * - iOS 下载失败时 fallback 到新窗口打开（用户长按保存）
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)

  // 创建真实的 a 标签并挂到 DOM，避免 iOS Safari 拦截
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)

  // 触发点击
  link.click()

  // 延迟清理
  setTimeout(() => {
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, 1000)
}

/**
 * 调用原生 app 方法
 */
export function postToNative(action: string, payload: Record<string, unknown> = {}): void {
  if (!isNativeApp()) return
  window.webkit?.messageHandlers.native.postMessage({ action, ...payload })
}

/**
 * 生成预览用降采样图（长边 2048px，白底非 alpha）
 * 用于 PreviewPanel 显示 + LUT 预览渲染，大幅降低常驻内存
 * 无论原图大小一律拍平白底、返回新 Image，彻底不保留透明通道
 */
export async function makePreviewImg(
  img: HTMLImageElement | HTMLCanvasElement,
  maxLongEdge = 2048,
): Promise<HTMLImageElement> {
  const longEdge = Math.max(img.width, img.height)
  const scale = Math.min(1, maxLongEdge / longEdge)
  const pw = Math.max(1, Math.round(img.width * scale))
  const ph = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = pw
  canvas.height = ph
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  // 白底：统一非 alpha（PNG 透明区域拍平成白，与导出 JPEG 铺白底一致）
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, pw, ph)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, pw, ph)

  const preview = new Image()
  await new Promise<void>((resolve, reject) => {
    // objectURL 而非 dataURL：避免 base64 字符串常驻在 Image.src 上
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('生成预览图失败'))
          return
        }
        const url = URL.createObjectURL(blob)
        preview.onload = () => {
          URL.revokeObjectURL(url)
          resolve()
        }
        preview.onerror = (e) => {
          URL.revokeObjectURL(url)
          reject(e)
        }
        preview.src = url
      },
      'image/jpeg',
      0.92,
    )
  })
  return preview
}

/**
 * 将图片拍平到白底，返回非 alpha 的 canvas（本工具不保留透明通道）
 */
export function flattenToWhite(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0)
  return canvas
}

/**
 * canvas → 高质量 JPEG Blob（quality 0.95，视觉无损）
 */
export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas toBlob 失败'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * 从压缩 Blob 按需解码全分辨率原图（仅导出时调用，用完调用方应释放）
 * 用 objectURL 而非 dataURL，避免 base64 字符串常驻内存
 */
export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

/**
 * 释放解码位图（把 Image 的解码像素从内存中赶出去）
 */
export function releaseImage(img: HTMLImageElement): void {
  img.src = ''
  img.onload = null
  img.onerror = null
}

/**
 * 从 file 加载图片，返回 { pixelBlob, previewImg, thumbDataURL, name, width, height, exif, originalBuffer }
 * 不再常驻全分辨率解码位图：pixelBlob 是压缩源（~10-20MB），导出时再 decodeFullImage 按需解码
 */
export async function loadImageFromFile(file: File): Promise<{
  pixelBlob: Blob
  previewImg: HTMLImageElement
  thumbDataURL: string
  name: string
  width: number
  height: number
  exif?: ExifInfo
  originalBuffer?: ArrayBuffer
}> {
  // 先读成 ArrayBuffer 用于 EXIF 解析，再转 dataURL 用于图片加载
  const arrayBuffer = await file.arrayBuffer()
  const exif = await parseExif(arrayBuffer)
  // 仅 JPEG 保留原始 buffer 用于 EXIF 写回
  const isJpeg =
    file.type === 'image/jpeg' || file.type === 'image/jpg' || /\.jpe?g$/i.test(file.name)
  const originalBuffer = isJpeg ? arrayBuffer : undefined

  const dataURL = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = reject
    img.src = dataURL
  })

  // 生成缩略图
  const thumbCanvas = document.createElement('canvas')
  const tw = 96
  const th = 96
  thumbCanvas.width = tw
  thumbCanvas.height = th
  const tctx = thumbCanvas.getContext('2d')
  if (!tctx) throw new Error('无法创建 canvas 上下文')

  const ratio = Math.max(tw / img.width, th / img.height)
  const dw = img.width * ratio
  const dh = img.height * ratio
  tctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh)

  // 生成预览降采样图
  const previewImg = await makePreviewImg(img)

  const w = img.width
  const h = img.height
  const isPng =
    file.type === 'image/png' || /\.png$/i.test(file.name)

  // PNG 一律拍平 alpha 到白底并转 JPEG 作为导出源（不保留透明通道，体积也更小）
  // JPEG 输入直接复用原文件（本身无 alpha，避免二次有损压缩）
  let pixelBlob: Blob
  if (isPng) {
    pixelBlob = await canvasToJpegBlob(flattenToWhite(img))
  } else {
    pixelBlob = file
  }

  // 生成完毕后立即释放临时全分辨率位图，只保留压缩源 pixelBlob 与独立预览图
  releaseImage(img)

  return {
    pixelBlob,
    previewImg,
    thumbDataURL: thumbCanvas.toDataURL('image/jpeg', 0.7),
    name: file.name,
    width: w,
    height: h,
    exif,
    originalBuffer,
  }
}

/**
 * 从 dataURL 加载图片并生成缩略图
 */
export async function loadImageFromDataURL(
  dataURL: string,
  fileName: string,
): Promise<{
  pixelBlob: Blob
  previewImg: HTMLImageElement
  thumbDataURL: string
  name: string
  width: number
  height: number
  exif?: ExifInfo
  originalBuffer?: ArrayBuffer
}> {
  // 先解析 EXIF
  let exif: ExifInfo | undefined
  let originalBuffer: ArrayBuffer | undefined
  try {
    const buffer = dataURLToArrayBuffer(dataURL)
    exif = await parseExif(buffer)
    // 判断是否 JPEG（FF D8 FF 开头）
    const view = new Uint8Array(buffer)
    if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
      originalBuffer = buffer
    }
  } catch {
    // 忽略 EXIF 解析错误
  }

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = reject
    img.src = dataURL
  })

  const thumbCanvas = document.createElement('canvas')
  const tw = 96
  const th = 96
  thumbCanvas.width = tw
  thumbCanvas.height = th
  const tctx = thumbCanvas.getContext('2d')
  if (!tctx) throw new Error('无法创建 canvas 上下文')

  const ratio = Math.max(tw / img.width, th / img.height)
  const dw = img.width * ratio
  const dh = img.height * ratio
  tctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh)

  // 生成预览降采样图
  const previewImg = await makePreviewImg(img)

  const w = img.width
  const h = img.height
  const isPng = /^data:image\/png/i.test(dataURL)

  // PNG 一律拍平 alpha 到白底并转 JPEG 作为导出源（不保留透明通道）
  let pixelBlob: Blob
  if (isPng) {
    pixelBlob = await canvasToJpegBlob(flattenToWhite(img))
  } else {
    pixelBlob = dataURLtoBlob(dataURL)
  }

  // 生成完毕后立即释放临时全分辨率位图，只保留压缩源 pixelBlob 与独立预览图
  releaseImage(img)

  return {
    pixelBlob,
    previewImg,
    thumbDataURL: thumbCanvas.toDataURL('image/jpeg', 0.7),
    name: fileName,
    width: w,
    height: h,
    exif,
    originalBuffer,
  }
}

/**
 * 绘制水印到 canvas 上下文
 */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasW: number,
  canvasH: number,
  fit: string,
  scale: number,
  posX: number,
  posY: number,
): void {
  let renderW: number
  let renderH: number
  let offsetX: number
  let offsetY: number

  if (fit === 'original') {
    renderW = (img.width * scale) / 100
    renderH = (img.height * scale) / 100
    offsetX = ((canvasW - renderW) * posX) / 100
    offsetY = ((canvasH - renderH) * posY) / 100
  } else {
    const imgRatio = img.width / img.height
    const dstRatio = canvasW / canvasH

    if (fit === 'contain') {
      if (imgRatio > dstRatio) {
        renderW = canvasW
        renderH = canvasW / imgRatio
      } else {
        renderH = canvasH
        renderW = canvasH * imgRatio
      }
    } else {
      // cover
      if (imgRatio > dstRatio) {
        renderH = canvasH
        renderW = canvasH * imgRatio
      } else {
        renderW = canvasW
        renderH = canvasW / imgRatio
      }
    }

    renderW = (renderW * scale) / 100
    renderH = (renderH * scale) / 100
    offsetX = ((canvasW - renderW) * posX) / 100
    offsetY = ((canvasH - renderH) * posY) / 100
  }

  ctx.drawImage(img, offsetX, offsetY, renderW, renderH)
}

/**
 * 生成输出文件名
 */
export function makeOutputName(originName: string, ext: string): string {
  if (originName) {
    const dotIdx = originName.lastIndexOf('.')
    const base = dotIdx > 0 ? originName.slice(0, dotIdx) : originName
    return `${base}_wm.${ext}`
  }
  return `watermark.${ext}`
}

/**
 * dataURL 转 Blob
 */
export function dataURLtoBlob(dataURL: string): Blob {
  const arr = dataURL.split(',')
  const mimeMatch = arr[0].match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/png'
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new Blob([u8arr], { type: mime })
}

/**
 * 预加载水印图片
 */
export function loadWatermark(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(e)
    img.src = src
  })
}

/**
 * 将度分秒数组 [度, 分, 秒] 转换为十进制度数
 * 兼容直接传入数字的情况（已为十进制时原样返回）
 */
function dmsToDecimal(value: number | number[]): number | null {
  if (typeof value === 'number') return value
  if (Array.isArray(value) && value.length >= 3) {
    const [d, m, s] = value
    return d + m / 60 + s / 3600
  }
  return null
}

/**
 * 从 TIFF 格式的 EXIF 数据中解析信息（exifr 原生支持 TIFF）
 */
export async function parseExifFromTiff(tiffBuffer: ArrayBuffer): Promise<ExifInfo | undefined> {
  try {
    const raw = await exifr.parse(tiffBuffer, [
      'Make',
      'Model',
      'LensModel',
      'LensMake',
      'FocalLength',
      'FNumber',
      'ExposureTime',
      'ISO',
      'DateTimeOriginal',
      'GPSLatitude',
      'GPSLongitude',
      'Software',
    ])
    if (!raw) return undefined
    return buildExifInfo(raw)
  } catch (err) {
    console.error('[parseExifFromTiff] 解析失败:', err)
    return undefined
  }
}

/**
 * 从 exifr 解析结果构建 ExifInfo 对象
 */
function buildExifInfo(raw: Record<string, unknown>): ExifInfo {
  const info: ExifInfo = {}
  if (raw.Make) info.make = String(raw.Make)
  if (raw.Model) info.model = String(raw.Model)
  if (raw.LensModel) info.lens = String(raw.LensModel)
  else if (raw.LensMake) info.lens = String(raw.LensMake)

  if (raw.FocalLength != null) info.focalLength = `${Math.round(raw.FocalLength as number)}mm`
  if (raw.FNumber != null) info.aperture = `f/${raw.FNumber}`

  if (raw.ExposureTime != null) {
    const t = raw.ExposureTime as number
    if (t >= 1) {
      info.shutterSpeed = `${t}s`
    } else {
      info.shutterSpeed = `1/${Math.round(1 / t)}s`
    }
  }

  if (raw.ISO != null) info.iso = `ISO ${raw.ISO}`
  if (raw.DateTimeOriginal) info.dateTime = String(raw.DateTimeOriginal)
  if (raw.Software) info.software = String(raw.Software)

  if (raw.GPSLatitude != null && raw.GPSLongitude != null) {
    const lat = dmsToDecimal(raw.GPSLatitude as number | number[])
    const lng = dmsToDecimal(raw.GPSLongitude as number | number[])
    if (lat != null && lng != null) {
      info.gps = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    }
  }

  return info
}

/**
 * 从文件 / dataURL 的 ArrayBuffer 中解析 EXIF 信息
 */
export async function parseExif(buffer: ArrayBuffer): Promise<ExifInfo | undefined> {
  try {
    const raw = await exifr.parse(buffer, [
      'Make',
      'Model',
      'LensModel',
      'LensMake',
      'FocalLength',
      'FNumber',
      'ExposureTime',
      'ISO',
      'DateTimeOriginal',
      'GPSLatitude',
      'GPSLongitude',
      'Software',
    ])
    if (!raw) return undefined

    return buildExifInfo(raw)
  } catch (err) {
    console.error('[parseExif] 解析失败:', err)
    return undefined
  }
}

/**
 * DataURL 转 ArrayBuffer（用于 EXIF 解析）
 */
export function dataURLToArrayBuffer(dataURL: string): ArrayBuffer {
  const base64 = dataURL.split(',')[1] ?? ''
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * 从 JPEG ArrayBuffer 中提取 APP1 (EXIF) 段字节（含 FF E1 + 长度 + "Exif\0\0" + 数据）
 * 未找到则返回 null
 */
function extractExifApp1(buffer: ArrayBuffer): Uint8Array | null {
  const view = new Uint8Array(buffer)
  // JPEG SOI: FF D8
  if (view.length < 4 || view[0] !== 0xff || view[1] !== 0xd8) {
    return null
  }

  let offset = 2
  let markerIndex = 0
  while (offset < view.length - 1) {
    // marker 必须以 FF 开头
    if (view[offset] !== 0xff) break
    const marker = view[offset + 1]
    const segLen = offset + 4 <= view.length ? (view[offset + 2] << 8) | view[offset + 3] : 0
    markerIndex++

    // APP1 marker: FF E1，且内容以 "Exif\0\0" 开头
    if (marker === 0xe1 && offset + 10 < view.length) {
      const sigBytes = view.slice(offset + 4, offset + 10)
      const sig = String.fromCharCode(...sigBytes)
      if (sig === 'Exif\0\0') {
        const app1Len = 2 + segLen
        return new Uint8Array(buffer, offset, app1Len)
      }
    }

    // 跳到下一个 marker
    if (offset + 4 > view.length) break
    offset += 2 + segLen

    // 跳过填充字节：FF 00 是转义的 FF（在图像数据中），FF FF 也是填充
    // 注意：必须保证跳到下一个 marker 开头（即 view[offset] === 0xff）
    while (offset < view.length - 1 && view[offset] === 0xff) {
      if (view[offset + 1] === 0x00) {
        // FF 00 是转义，不是 marker 开头，跳过这 2 字节
        offset += 2
      } else if (view[offset + 1] === 0xff) {
        // 连续 FF（填充），跳过一个 FF
        offset += 1
      } else {
        // 下一个字节是有效 marker，停止跳过
        break
      }
    }

    // 扫描到 SOS (FF DA) 或 EOI (FF D9) 就停止
    if (marker === 0xda || marker === 0xd9) break

    // 安全限制：最多扫描 50 个 marker
    if (markerIndex > 50) break
  }

  return null
}

/**
 * 从 HEIC/HEIF 文件中提取原始 EXIF TIFF 数据（不含 "Exif\0\0" 前缀）
 * HEIC 基于 ISO BMFF，EXIF 存储在 meta box 的 iloc 中。
 * 成功返回 Uint8Array（TIFF 原始数据），失败返回 null
 */
export function extractExifFromHeic(buffer: ArrayBuffer): Uint8Array | null {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // 读取 box：4字节 size + 4字节 type
  function readBox(off: number): { size: number; type: string; end: number } | null {
    if (off + 8 > view.byteLength) return null
    let size = view.getUint32(off)
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
    if (size === 1 && off + 16 <= view.byteLength) {
      // 64-bit size
      size = Number(view.getBigUint64(off + 8))
    }
    if (size < 8) return null
    return { size, type, end: off + size }
  }

  // 递归查找 box 路径（返回目标 box 内容起始 offset，即 header 之后）
  function findBox(off: number, end: number, path: string[]): number | null {
    if (path.length === 0) return off
    const target = path[0]
    let pos = off
    while (pos + 8 <= end) {
      const box = readBox(pos)
      if (!box) break
      if (box.type === target) {
        const result = findBox(pos + 8, box.end, path.slice(1))
        if (result !== null) return result
      }
      pos = box.end
      if (pos >= end) break
    }
    return null
  }

  // 标准 HEIC EXIF 位置：meta → iloc 中 itemId=Exif 的数据偏移
  // 先找 meta box
  const metaOffset = findBox(0, view.byteLength, ['meta'])
  if (metaOffset === null) return null

  // 读取 meta box 的完整范围
  const metaBox = readBox(metaOffset - 8) // meta box 起点（包含 header）
  if (!metaBox) return null
  const metaEnd = metaBox.end

  // meta box 内容开头有 version(1) + flags(3) = 4 字节，之后才是子 box
  const metaContentStart = metaOffset + 4

  // 先解析 iinf，找 type 为 "Exif" 的 item 拿到 itemId
  let exifItemId: number | null = null
  {
    const iinfOff = findBox(metaContentStart, metaEnd, ['iinf'])
    if (iinfOff !== null) {
      // iinf header: version(1) + flags(3) + count(2)
      const count = view.getUint16(iinfOff + 4)
      let pos = iinfOff + 6
      for (let i = 0; i < count; i++) {
        // infe box
        const infe = readBox(pos)
        if (!infe) break
        const infeContent = pos + 8
        // infe version 0/1/2 用 16bit item_ID，version 3 用 32bit
        const infeVersion = view.getUint8(infeContent)
        const itemId =
          infeVersion >= 3 ? view.getUint32(infeContent + 4) : view.getUint16(infeContent + 4)
        // 扫内容找 "Exif" 字符串
        const contentBytes = new Uint8Array(buffer, infeContent + 6, infe.end - infeContent - 6)
        let found = false
        for (let j = 0; j < contentBytes.length - 3; j++) {
          if (
            contentBytes[j] === 0x45 && // E
            contentBytes[j + 1] === 0x78 && // x
            contentBytes[j + 2] === 0x69 && // i
            contentBytes[j + 3] === 0x66 // f
          ) {
            found = true
            break
          }
        }
        if (found) {
          exifItemId = itemId
          break
        }
        pos = infe.end
      }
    }
  }

  if (exifItemId === null) return null

  // 再解析 iloc 找到 itemId 对应的数据偏移和长度
  {
    const ilocOff = findBox(metaContentStart, metaEnd, ['iloc'])
    if (ilocOff === null) return null

    // iloc 结构（FullBox）：
    //   version(1) + flags(3)
    //   byte 0: offset_size(4bit) | length_size(4bit)
    //   byte 1: base_offset_size(4bit) | (version==2 ? index_size : reserved)(4bit)
    //   item_count(2字节 for v0/v1, 4字节 for v2)
    const version = view.getUint8(ilocOff)
    const sizeByte1 = view.getUint8(ilocOff + 4)
    const sizeByte2 = view.getUint8(ilocOff + 5)
    const offsetSize = (sizeByte1 >> 4) & 0xf
    const lengthSize = sizeByte1 & 0xf
    const baseOffsetSize = (sizeByte2 >> 4) & 0xf
    const indexSize = version === 2 ? (sizeByte2 & 0xf) : 0

    let pos = ilocOff + 6 // version(1)+flags(3)+sizeByte1(1)+sizeByte2(1) = 6 字节
    const itemCount = version === 2 ? view.getUint32(pos) : view.getUint16(pos)
    pos += version === 2 ? 4 : 2

    for (let i = 0; i < itemCount; i++) {
      const itemId = version === 2 ? view.getUint32(pos) : view.getUint16(pos)
      pos += version === 2 ? 4 : 2
      // version 1/2：item_ID 后有 construction_method（reserved 12bit + construction_method 4bit，共 2 字节）
      // version 0 没有该字段
      pos += version >= 1 ? 2 : 0
      // data_reference_index (2 bytes)
      pos += 2
      // base_offset
      let baseOffset = 0
      if (baseOffsetSize === 4) baseOffset = view.getUint32(pos)
      else if (baseOffsetSize === 8) baseOffset = Number(view.getBigUint64(pos))
      pos += baseOffsetSize
      const extentCount = view.getUint16(pos)
      pos += 2

      if (itemId === exifItemId) {
        // 找到 EXIF item，读取第一个 extent
        // extent_index (index_size, v2) + extent_offset (offset_size) + extent_length (length_size)
        pos += indexSize
        let extentOffset = 0
        if (offsetSize === 4) extentOffset = view.getUint32(pos)
        else if (offsetSize === 8) extentOffset = Number(view.getBigUint64(pos))
        pos += offsetSize

        let extentLength = 0
        if (lengthSize === 4) extentLength = view.getUint32(pos)
        else if (lengthSize === 8) extentLength = Number(view.getBigUint64(pos))

        // 加上 baseOffset
        extentOffset += baseOffset

        // HEIC 的 EXIF 数据（ExifDataBlock）布局：
        //   [4字节] exif_tiff_header_offset（相对"offset 字段之后"的偏移，通常=6="Exif\0\0"长度）
        //   [6字节] "Exif\0\0"
        //   [N字节] TIFF 数据（"II"/"MM" 开头）
        if (extentOffset + 4 > view.byteLength) return null

        const tiffOffset = view.getUint32(extentOffset)
        const tiffStart = extentOffset + 4 + tiffOffset
        const tiffLength = extentLength - 4 - tiffOffset

        if (tiffStart + tiffLength > view.byteLength) return null
        return new Uint8Array(buffer, tiffStart, tiffLength)
      }

      // 跳过所有 extents
      for (let e = 0; e < extentCount; e++) {
        pos += indexSize + offsetSize + lengthSize
      }
    }
  }

  return null
}

/**
 * 将 TIFF 格式的 EXIF 数据包装成 JPEG APP1 (FF E1 + 长度 + Exif\0\0 + TIFF) 段
 */
function buildApp1FromTiff(tiffData: Uint8Array): Uint8Array {
  const app1Len = 2 + 2 + 6 + tiffData.length // marker(2) + length(2) + "Exif\0\0"(6) + tiff
  const app1 = new Uint8Array(app1Len)
  app1[0] = 0xff
  app1[1] = 0xe1
  // length 字段含 2 字节 length 自身
  const dataLen = 2 + 6 + tiffData.length // length字段(2) + Exif\0\0(6) + tiff
  app1[2] = (dataLen >> 8) & 0xff
  app1[3] = dataLen & 0xff
  // "Exif\0\0"
  app1[4] = 0x45 // E
  app1[5] = 0x78 // x
  app1[6] = 0x69 // i
  app1[7] = 0x66 // f
  app1[8] = 0x00
  app1[9] = 0x00
  // TIFF 数据
  app1.set(tiffData, 10)
  return app1
}

/**
 * 从原始 buffer（JPEG 或 HEIC）中提取纯 TIFF 格式的 EXIF 数据（II/MM 开头）
 * 失败返回 null
 */
function extractTiffFromBuffer(buffer: ArrayBuffer): Uint8Array | null {
  const bytes = new Uint8Array(buffer)
  // JPEG: FF D8 FF 开头 → 剥掉 APP1 的 FF E1(2) + 长度(2) + "Exif\0\0"(6) 共 10 字节
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const app1 = extractExifApp1(buffer)
    if (app1 && app1.length > 10) return app1.slice(10)
    return null
  }
  // HEIC: ftyp box 开头（4字节size + "ftyp"）→ 提取的就是纯 TIFF
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return extractExifFromHeic(buffer)
  }
  return null
}

/**
 * 从原始 buffer（JPEG 或 HEIC）中提取可注入 JPEG 的 APP1 段
 * 失败返回 null
 */
function extractExifApp1FromBuffer(buffer: ArrayBuffer): Uint8Array | null {
  const tiffData = extractTiffFromBuffer(buffer)
  if (tiffData) return buildApp1FromTiff(tiffData)
  return null
}

/**
 * 将原始 EXIF (APP1 段) 注入到新的 JPEG Blob 中，返回新的 Blob
 * 支持从 JPEG 或 HEIC 原始文件中提取 EXIF
 * 仅对 JPEG 导出有效；非 JPEG 或无原始 EXIF 时返回原 blob
 *
 * 原理：新 JPEG 结构为 SOI (FF D8) + APP0 (JFIF) + ... + 图像数据
 * 我们在 SOI 之后插入 APP1 (EXIF) 段，然后拼接其余部分。
 */
export function injectExifToJpeg(
  newJpegBlob: Blob,
  originalBuffer: ArrayBuffer | undefined,
): Promise<Blob> {
  return new Promise((resolve) => {
    if (!originalBuffer) {
      resolve(newJpegBlob)
      return
    }

    const app1 = extractExifApp1FromBuffer(originalBuffer)
    if (!app1) {
      resolve(newJpegBlob)
      return
    }

    // 只读取前 32 字节用于定位插入点，避免把整张图读进内存
    const headSize = Math.min(newJpegBlob.size, 32)
    const reader = new FileReader()
    reader.onload = () => {
      const head = new Uint8Array(reader.result as ArrayBuffer)
      // 验证新文件也是 JPEG
      if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) {
        resolve(newJpegBlob)
        return
      }

      // 找到 SOI 之后第一个 marker 的起始位置（通常是 FF E0 / APP0）
      let insertAt = 2 // 紧跟 SOI 之后
      if (head[2] === 0xff && head[3] === 0xe0) {
        // 存在 APP0 (JFIF)，跳过它
        const app0Len = (head[4] << 8) | head[5]
        insertAt = 2 + 2 + app0Len // SOI(2) + FF E0(2) + 长度字段后的数据
      }

      // 零拷贝组装：Blob 底层直接引用原始 buffer 切片，不做像素级全量复制
      const before = newJpegBlob.slice(0, insertAt, 'image/jpeg')
      const after = newJpegBlob.slice(insertAt, newJpegBlob.size, 'image/jpeg')
      const finalBlob = new Blob([before, app1, after], { type: 'image/jpeg' })
      resolve(finalBlob)
    }
    reader.onerror = () => resolve(newJpegBlob)
    reader.readAsArrayBuffer(newJpegBlob.slice(0, headSize))
  })
}

/**
 * PNG 标准 CRC-32（IEEE 802.3，反射多项式 0xEDB88320）
 * 计算范围：type 码 + data（不含 length 与 CRC 自身）
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * 将纯 TIFF 数据包装成 PNG eXIf chunk（length + "eXIf" + TIFF + CRC）
 */
function buildExifChunk(tiffData: Uint8Array): Uint8Array {
  // length(4) + type(4) + data + crc(4)
  const chunk = new Uint8Array(12 + tiffData.length)
  const len = tiffData.length
  chunk[0] = (len >>> 24) & 0xff
  chunk[1] = (len >>> 16) & 0xff
  chunk[2] = (len >>> 8) & 0xff
  chunk[3] = len & 0xff
  // type: "eXIf"
  chunk[4] = 0x65
  chunk[5] = 0x58
  chunk[6] = 0x49
  chunk[7] = 0x66
  chunk.set(tiffData, 8)

  // CRC 计算范围是 type + data（chunk[4] 起）
  const crc = crc32(chunk.subarray(4, 8 + tiffData.length))
  const crcOffset = 8 + tiffData.length
  chunk[crcOffset] = (crc >>> 24) & 0xff
  chunk[crcOffset + 1] = (crc >>> 16) & 0xff
  chunk[crcOffset + 2] = (crc >>> 8) & 0xff
  chunk[crcOffset + 3] = crc & 0xff
  return chunk
}

/**
 * 将原始 EXIF 以 eXIf chunk 的形式注入到 PNG Blob 中，返回新的 Blob
 * 支持从 JPEG 或 HEIC 原始文件中提取 EXIF
 * 无原始 EXIF 或非 PNG 时返回原 blob
 *
 * 原理：PNG 结构为 签名(8) + IHDR + IDAT + IEND。
 * eXIf 是 ancillary chunk，必须在 IDAT 之前，故插在 IHDR 之后。
 */
export function injectExifToPng(
  newPngBlob: Blob,
  originalBuffer: ArrayBuffer | undefined,
): Promise<Blob> {
  return new Promise((resolve) => {
    if (!originalBuffer) {
      resolve(newPngBlob)
      return
    }

    const tiffData = extractTiffFromBuffer(originalBuffer)
    if (!tiffData) {
      resolve(newPngBlob)
      return
    }

    const exifChunk = buildExifChunk(tiffData)

    // 只读取前 32 字节用于定位 IHDR 结束位置，避免把整张图读进内存
    const headSize = Math.min(newPngBlob.size, 32)
    const reader = new FileReader()
    reader.onload = () => {
      const head = new Uint8Array(reader.result as ArrayBuffer)
      // PNG 签名：89 50 4E 47 0D 0A 1A 0A
      const PNG_SIGN = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      if (head.length < 8 + 8 || !PNG_SIGN.every((b, i) => head[i] === b)) {
        resolve(newPngBlob)
        return
      }

      // 定位首个 chunk（IHDR）的结束位置：签名(8) + length(4) + type(4) + data + crc(4)
      const ihdrLen =
        ((head[8] << 24) | (head[9] << 16) | (head[10] << 8) | head[11]) >>> 0
      const insertAt = 8 + 4 + 4 + ihdrLen + 4 // 签名 + length + type + data + crc

      // 零拷贝组装：Blob 底层直接引用原始 buffer 切片，不做像素级全量复制
      const before = newPngBlob.slice(0, insertAt, 'image/png')
      const after = newPngBlob.slice(insertAt, newPngBlob.size, 'image/png')
      const finalBlob = new Blob([before, exifChunk, after], { type: 'image/png' })
      resolve(finalBlob)
    }
    reader.onerror = () => resolve(newPngBlob)
    reader.readAsArrayBuffer(newPngBlob.slice(0, headSize))
  })
}

/**
 * 规范化品牌名称（用于 EXIF make 与文件夹名匹配）
 * 忽略大小写、空格、连字符等差异
 */
function normalizeBrand(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/**
 * 规范化型号名称（用于 EXIF model 与水印文件名匹配）
 * 忽略大小写、空格、连字符、前缀品牌名等
 */
function normalizeModel(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/**
 * 根据 EXIF 信息和图片尺寸自动检测匹配的水印
 *
 * 匹配规则（精确匹配，两边均规范化后对比）：
 * 1. 有 make 时：先匹配品牌，再在品牌内匹配型号
 * 2. 无 make 时：直接用 model 在所有品牌中匹配型号（反推品牌）
 * 3. 型号匹配：EXIF.model → 水印文件名去掉 -横屏/-竖屏 后缀
 * 4. 方向匹配：宽 > 高 → 横屏；宽 ≤ 高（含正方形）→ 竖屏
 *
 * @param exif EXIF 信息
 * @param width 图片宽度
 * @param height 图片高度
 * @returns 匹配到的水印 key，未匹配到返回空字符串
 */
export function autoDetectWatermark(
  exif: ExifInfo | undefined,
  width: number,
  height: number,
): string {
  if (!exif || !exif.model) return ''

  const modelNorm = normalizeModel(exif.model)
  const makeNorm = exif.make ? normalizeBrand(exif.make) : null

  // 判断横竖屏：宽 > 高 为横屏，否则为竖屏（正方形用竖屏）
  const isLandscape = width > height
  const orientationSuffix = isLandscape ? '-横屏' : '-竖屏'

  // 遍历所有品牌匹配型号
  for (const brand of BRANDS) {
    // 有 make 时先匹配品牌
    if (makeNorm) {
      const brandNorm = normalizeBrand(brand.key)
      if (brandNorm !== makeNorm) continue
    }

    for (const wm of brand.watermarks) {
      // 水印文件名格式：<型号>-<横屏/竖屏>
      const wmName = wm.value.split('/').pop() || ''
      // 方向必须匹配
      if (!wmName.endsWith(orientationSuffix)) continue
      // 去掉方向后缀，得到纯型号名
      const wmModel = wmName.slice(0, -orientationSuffix.length)
      const wmModelNorm = normalizeModel(wmModel)

      if (wmModelNorm === modelNorm) {
        return wm.value
      }
    }
  }

  return ''
}
