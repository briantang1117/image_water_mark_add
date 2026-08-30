import exifr from 'exifr'
import type { ExifInfo } from '@/types'

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
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ 伪装成 Mac，但有触控
    (navigator.platform === 'MacIntel' && 'ontouchend' in document)
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
 * 从 file 加载图片，返回 { img, thumbDataURL, name, width, height, exif, originalBuffer }
 */
export async function loadImageFromFile(file: File): Promise<{
  img: HTMLImageElement
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
    file.type === 'image/jpeg' ||
    file.type === 'image/jpg' ||
    /\.jpe?g$/i.test(file.name)
  const originalBuffer = isJpeg ? arrayBuffer : undefined
  console.log(
    `[loadImageFromFile] ${file.name}: type=${file.type}, isJpeg=${isJpeg}, ` +
      `buffer=${arrayBuffer.byteLength}, exif=${exif ? '有' : '无'}`,
  )

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

  return {
    img,
    thumbDataURL: thumbCanvas.toDataURL('image/jpeg', 0.7),
    name: file.name,
    width: img.width,
    height: img.height,
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
  img: HTMLImageElement
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

  return {
    img,
    thumbDataURL: thumbCanvas.toDataURL('image/jpeg', 0.7),
    name: fileName,
    width: img.width,
    height: img.height,
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

    const info: ExifInfo = {}
    if (raw.Make) info.make = String(raw.Make)
    if (raw.Model) info.model = String(raw.Model)
    if (raw.LensModel) info.lens = String(raw.LensModel)
    else if (raw.LensMake) info.lens = String(raw.LensMake)

    if (raw.FocalLength != null) info.focalLength = `${Math.round(raw.FocalLength)}mm`
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
  } catch {
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
    console.warn('[extractExifApp1] 不是有效的 JPEG（无 SOI）')
    return null
  }

  let offset = 2
  let markerIndex = 0
  while (offset < view.length - 1) {
    // marker 必须以 FF 开头
    if (view[offset] !== 0xff) {
      console.warn(`[extractExifApp1] marker 扫描中断: offset=${offset}, byte=0x${view[offset].toString(16)}`)
      break
    }
    const marker = view[offset + 1]
    const segLen = offset + 4 <= view.length ? (view[offset + 2] << 8) | view[offset + 3] : 0
    markerIndex++

    console.log(
      `[extractExifApp1] marker #${markerIndex}: 0x${marker.toString(16).padStart(2, '0')} ` +
        `(FF ${marker.toString(16).padStart(2, '0')}) ` +
        `offset=${offset}, len=${segLen}`,
    )

    // APP1 marker: FF E1，且内容以 "Exif\0\0" 开头
    if (marker === 0xe1 && offset + 10 < view.length) {
      // 检查 "Exif\0\0" 签名
      const sigBytes = view.slice(offset + 4, offset + 10)
      const sig = String.fromCharCode(...sigBytes)
      console.log(`[extractExifApp1] 找到 APP1，签名前6字节: `, Array.from(sigBytes).map(b => b.toString(16)).join(' '), `"${sig}"`)
      if (sig === 'Exif\0\0') {
        const app1Len = 2 + segLen
        console.log(`[extractExifApp1] ✅ 匹配 Exif 签名，APP1 段长度=${app1Len}`)
        return new Uint8Array(buffer, offset, app1Len)
      } else {
        console.log(`[extractExifApp1] APP1 但非 Exif 签名，跳过`)
      }
    }

    // 跳到下一个 marker
    if (offset + 4 > view.length) {
      console.warn('[extractExifApp1] 数据不足，提前退出')
      break
    }
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
    // 调试：检查下一个位置是不是 FF
    if (offset < view.length && view[offset] !== 0xff) {
      console.warn(
        `[extractExifApp1] ⚠️ offset=${offset} 处不是 FF（0x${view[offset].toString(16)}），` +
          `可能已进入图像数据区`,
      )
    }

    // 扫描到 SOS (FF DA) 或 DQT (FF DB) 等之后的图像数据段就停止
    if (marker === 0xda || marker === 0xd9) {
      console.log(`[extractExifApp1] 到达图像数据/EOI marker (0x${marker.toString(16)})，停止扫描`)
      break
    }

    // 安全限制：最多扫描 50 个 marker
    if (markerIndex > 50) {
      console.warn('[extractExifApp1] 扫描超过 50 个 marker，强制停止')
      break
    }
  }

  console.warn('[extractExifApp1] ❌ 未找到 Exif APP1 段')
  return null
}

/**
 * 将原始 EXIF (APP1 段) 注入到新的 JPEG Blob 中，返回新的 Blob
 * 仅对 JPEG 有效；非 JPEG 或无原始 EXIF 时返回原 blob
 *
 * 原理：新 JPEG 结构为 SOI (FF D8) + APP0 (JFIF) + ... + 图像数据
 * 我们在 SOI 之后插入 APP1 (EXIF) 段，然后拼接其余部分。
 */
export function injectExifToJpeg(
  newJpegBlob: Blob,
  originalBuffer: ArrayBuffer | undefined,
): Promise<Blob> {
  return new Promise((resolve) => {
    console.log(
      `[injectExifToJpeg] 调用：新图大小=${newJpegBlob.size}, ` +
        `原始buffer=${originalBuffer ? originalBuffer.byteLength : '无'}`,
    )
    if (!originalBuffer) {
      console.warn('[injectExifToJpeg] 无原始 buffer，跳过')
      resolve(newJpegBlob)
      return
    }

    const app1 = extractExifApp1(originalBuffer)
    if (!app1) {
      console.warn('[injectExifToJpeg] 提取 APP1 失败，跳过')
      resolve(newJpegBlob)
      return
    }
    console.log(`[injectExifToJpeg] 提取到 APP1，长度=${app1.length}`)

    const reader = new FileReader()
    reader.onload = () => {
      const newBytes = new Uint8Array(reader.result as ArrayBuffer)
      // 验证新文件也是 JPEG
      if (newBytes.length < 4 || newBytes[0] !== 0xff || newBytes[1] !== 0xd8) {
        resolve(newJpegBlob)
        return
      }

      // 找到 SOI 之后第一个 marker 的起始位置（通常是 FF E0 / APP0）
      let insertAt = 2 // 紧跟 SOI 之后
      if (newBytes[2] === 0xff && newBytes[3] === 0xe0) {
        // 存在 APP0 (JFIF)，跳过它
        const app0Len = (newBytes[4] << 8) | newBytes[5]
        insertAt = 2 + 2 + app0Len // SOI(2) + FF E0(2) + 长度字段后的数据
      }

      // 组装：SOI + [APP0] + APP1(EXIF) + 剩余部分
      const before = newBytes.slice(0, insertAt)
      const after = newBytes.slice(insertAt)
      const result = new Uint8Array(before.length + app1.length + after.length)
      result.set(before, 0)
      result.set(app1, before.length)
      result.set(after, before.length + app1.length)

      resolve(new Blob([result], { type: 'image/jpeg' }))
    }
    reader.onerror = () => resolve(newJpegBlob)
    reader.readAsArrayBuffer(newJpegBlob)
  })
}
