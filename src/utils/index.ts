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
 * 调用原生 app 方法
 */
export function postToNative(action: string, payload: Record<string, unknown> = {}): void {
  if (!isNativeApp()) return
  window.webkit?.messageHandlers.native.postMessage({ action, ...payload })
}

/**
 * 从 file 加载图片，返回 { img, thumbDataURL, name }
 */
export function loadImageFromFile(file: File): Promise<{
  img: HTMLImageElement
  thumbDataURL: string
  name: string
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataURL = e.target?.result as string
      const img = new Image()
      img.onload = () => {
        // 生成缩略图
        const thumbCanvas = document.createElement('canvas')
        const tw = 96
        const th = 96
        thumbCanvas.width = tw
        thumbCanvas.height = th
        const tctx = thumbCanvas.getContext('2d')
        if (!tctx) {
          reject(new Error('无法创建 canvas 上下文'))
          return
        }
        // cover 裁剪
        const ratio = Math.max(tw / img.width, th / img.height)
        const dw = img.width * ratio
        const dh = img.height * ratio
        tctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh)
        resolve({
          img,
          thumbDataURL: thumbCanvas.toDataURL('image/jpeg', 0.7),
          name: file.name,
        })
      }
      img.onerror = reject
      img.src = dataURL
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * 从 dataURL 加载图片并生成缩略图
 */
export function loadImageFromDataURL(
  dataURL: string,
  fileName: string,
): Promise<{
  img: HTMLImageElement
  thumbDataURL: string
  name: string
}> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const thumbCanvas = document.createElement('canvas')
      const tw = 96
      const th = 96
      thumbCanvas.width = tw
      thumbCanvas.height = th
      const tctx = thumbCanvas.getContext('2d')
      if (!tctx) {
        reject(new Error('无法创建 canvas 上下文'))
        return
      }
      const ratio = Math.max(tw / img.width, th / img.height)
      const dw = img.width * ratio
      const dh = img.height * ratio
      tctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh)
      resolve({
        img,
        thumbDataURL: thumbCanvas.toDataURL('image/jpeg', 0.7),
        name: fileName,
      })
    }
    img.onerror = reject
    img.src = dataURL
  })
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
