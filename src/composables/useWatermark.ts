import { computed, reactive, ref } from 'vue'
import type { ImageItem, WatermarkMap } from '@/types'
import {
  autoDetectWatermark,
  drawWatermark,
  extractExifFromHeic,
  injectExifToJpeg,
  loadImageFromDataURL,
  loadImageFromFile,
  loadWatermark,
  parseExifFromTiff,
} from '@/utils'
import { isHeicFile, heicToJpg } from '@/utils/heicConvert'
import {
  DEFAULT_PARAMS,
  WATERMARK_SOURCES,
  BRANDS,
  DEFAULT_BRAND_KEY,
  MAX_IMAGES,
} from '@/constants'

// ==================== 全局单例状态 ====================

const imageList = ref<ImageItem[]>([])
const currentIndex = ref(-1)
let nextId = 1

const watermarks = ref<WatermarkMap>({})
const watermarkLoaded = reactive<Record<string, boolean>>({})

// 全局渲染参数（混合模式、不透明度、大小、位置、导出格式等）
const params = reactive({ ...DEFAULT_PARAMS })

const status = ref('')
const progress = ref('')
const error = ref('')

let preloaded = false

// ==================== 计算属性 ====================

const currentImage = computed(() => {
  if (currentIndex.value < 0 || currentIndex.value >= imageList.value.length) return null
  return imageList.value[currentIndex.value]
})

// 当前选中图片的 wmKey
const currentWmKey = computed({
  get(): string {
    const img = currentImage.value
    return img?.wmKey ?? ''
  },
  set(val: string) {
    const img = currentImage.value
    if (img) {
      img.wmKey = val
    }
    params.wmKey = val
  },
})

// 从 wmKey 解析品牌 key
function extractBrandFromWmKey(wmKey: string): string {
  return wmKey.split('/')[0] ?? DEFAULT_BRAND_KEY
}

// 当前品牌 key
const currentBrandKey = computed({
  get(): string {
    const wmKey = currentWmKey.value
    if (!wmKey) return DEFAULT_BRAND_KEY
    return extractBrandFromWmKey(wmKey)
  },
  set(brandKey: string) {
    const brand = BRANDS.find((b) => b.key === brandKey)
    if (brand && brand.watermarks.length > 0) {
      const firstLandscape = brand.watermarks.find((w) => w.value.endsWith('-横屏'))
      currentWmKey.value = firstLandscape?.value ?? brand.watermarks[0].value
    }
  },
})

// ==================== 方法 ====================

// 预加载所有水印
async function preloadWatermarks(): Promise<void> {
  if (preloaded) return
  preloaded = true
  const entries = Object.entries(WATERMARK_SOURCES)
  await Promise.all(
    entries.map(async ([key, src]) => {
      try {
        watermarks.value[key] = await loadWatermark(src)
        watermarkLoaded[key] = true
      } catch (e) {
        console.error(`水印加载失败: ${key}`, e)
      }
    }),
  )
}

// 添加多张图片
async function addFiles(fileList: FileList | File[]): Promise<void> {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/') || isHeicFile(f))
  if (!files.length) return

  // 9 张硬上限：只取还能容纳的数量
  const remaining = MAX_IMAGES - imageList.value.length
  if (remaining <= 0) {
    status.value = `最多 ${MAX_IMAGES} 张图片`
    return
  }
  const accepted = files.slice(0, remaining)
  const skipped = files.length - accepted.length
  if (skipped > 0) {
    console.warn(`已达到 ${MAX_IMAGES} 张上限，跳过 ${skipped} 张`)
  }

  status.value = `正在加载 ${accepted.length} 张图片...`
  progress.value = ''

  let loaded = 0
  for (const file of accepted) {
    // HEIC/HEIF 先转高质量 JPEG；转换失败提示并跳过，不入列表
    let fileToLoad = file
    let heicExif: Awaited<ReturnType<typeof parseExifFromTiff>> = undefined
    let heicOriginalBuffer: ArrayBuffer | undefined = undefined
    if (isHeicFile(file)) {
      try {
        // 先从原始 HEIC 读取 buffer
        heicOriginalBuffer = await file.arrayBuffer()
        // 用手写的 HEIC 解析器提取 TIFF 格式的 EXIF 数据
        const tiffData = extractExifFromHeic(heicOriginalBuffer)
        // 再用 exifr 解析 TIFF（exifr 对 TIFF 支持很成熟）
        if (tiffData) {
          // 拷贝到独立 buffer（tiffData 是大 buffer 的切片，.buffer 是完整原始 buffer）
          const tiffBuffer = new Uint8Array(tiffData).buffer
          heicExif = await parseExifFromTiff(tiffBuffer)
        }
        // 再转高质量 JPEG 用于加载像素（也是导出源）
        fileToLoad = await heicToJpg(file)
      } catch (e) {
        console.error('HEIC 转换失败:', file.name, e)
        alert(`「${file.name}」转换失败，已跳过`)
        continue
      }
    }

    try {
      const { pixelBlob, previewImg, thumbDataURL, width, height, exif, originalBuffer } =
        await loadImageFromFile(fileToLoad)

      // HEIC 场景：用原始 HEIC 的 EXIF 覆盖（JPEG 转换产物不带原始 EXIF）
      const finalExif = heicExif ?? exif
      const finalOriginalBuffer = heicOriginalBuffer ?? originalBuffer

      const wmKey = autoDetectWatermark(finalExif, width, height)

      imageList.value.push({
        id: nextId++,
        name: file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'),
        pixelBlob,
        previewImg,
        thumbDataURL,
        width,
        height,
        exif: finalExif,
        originalBuffer: finalOriginalBuffer,
        wmKey,
        lutId: '',
        lutIntensity: 50,
        lutMode: 'ps' as const,
      })
      loaded++
      status.value = `正在加载... ${loaded}/${accepted.length}`
    } catch (e) {
      console.error('加载失败:', file.name, e)
    }
  }

  status.value = ''

  if (currentIndex.value < 0 && imageList.value.length > 0) {
    selectImage(0)
  }
}

// 从 dataURL 添加一张图片
async function addImageFromDataURL(dataURL: string, fileName: string): Promise<void> {
  if (imageList.value.length >= MAX_IMAGES) {
    status.value = `最多 ${MAX_IMAGES} 张图片`
    return
  }
  try {
    const { pixelBlob, previewImg, thumbDataURL, name, width, height, exif, originalBuffer } =
      await loadImageFromDataURL(dataURL, fileName)

    const wmKey = autoDetectWatermark(exif, width, height)

    imageList.value.push({
      id: nextId++,
      name,
      pixelBlob,
      previewImg,
      thumbDataURL,
      width,
      height,
      exif,
      originalBuffer,
      wmKey,
      lutId: '',
      lutIntensity: 50,
      lutMode: 'ps' as const,
    })
    if (currentIndex.value < 0) {
      selectImage(0)
    }
  } catch (e) {
    console.error('加载失败:', fileName, e)
  }
}

// 选中某张图片
function selectImage(index: number): void {
  if (index < 0 || index >= imageList.value.length) return
  currentIndex.value = index
  const img = imageList.value[index]
  params.wmKey = img.wmKey
}

// 删除单张图片
function removeImage(index: number): void {
  if (index < 0 || index >= imageList.value.length) return
  imageList.value.splice(index, 1)

  if (imageList.value.length === 0) {
    currentIndex.value = -1
    params.wmKey = ''
  } else if (index === currentIndex.value) {
    currentIndex.value = Math.min(index, imageList.value.length - 1)
    params.wmKey = imageList.value[currentIndex.value].wmKey
  } else if (index < currentIndex.value) {
    currentIndex.value--
  }
}

// 清空列表
function clearList(): void {
  if (imageList.value.length === 0) return
  imageList.value = []
  currentIndex.value = -1
  params.wmKey = ''
  status.value = ''
  progress.value = ''
  error.value = ''
}

// 渲染到指定 canvas
function renderToCanvas(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  img: HTMLImageElement,
  wmKey?: string,
): void {
  const key = wmKey ?? currentWmKey.value
  const watermarkImg = key ? watermarks.value[key] : null

  ctx.clearRect(0, 0, canvasW, canvasH)

  if (params.format === 'jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvasW, canvasH)
  }

  ctx.drawImage(img, 0, 0)

  if (!watermarkImg) return

  ctx.globalCompositeOperation = params.blendMode as GlobalCompositeOperation
  ctx.globalAlpha = params.opacity / 100
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  drawWatermark(
    ctx,
    watermarkImg,
    canvasW,
    canvasH,
    params.fitMode,
    params.scale,
    params.posX,
    params.posY,
  )

  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

// 导出图片为 dataURL
function exportImageDataURL(
  img: HTMLImageElement,
  wmKey?: string,
): {
  dataURL: string
  ext: string
} {
  const key = wmKey ?? currentWmKey.value

  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = img.width
  exportCanvas.height = img.height
  const ectx = exportCanvas.getContext('2d')
  if (!ectx) throw new Error('无法创建 canvas 上下文')

  const quality = params.quality / 100

  renderToCanvas(ectx, img.width, img.height, img, key)

  if (params.format === 'png') {
    return { dataURL: exportCanvas.toDataURL('image/png'), ext: 'png' }
  } else {
    return { dataURL: exportCanvas.toDataURL('image/jpeg', quality), ext: 'jpg' }
  }
}

// 导出图片为 Blob
async function exportImageBlob(
  img: HTMLImageElement,
  originalBuffer?: ArrayBuffer,
  wmKey?: string,
): Promise<{ blob: Blob; ext: string }> {
  const key = wmKey ?? currentWmKey.value

  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = img.width
  exportCanvas.height = img.height
  const ectx = exportCanvas.getContext('2d')
  if (!ectx) throw new Error('无法创建 canvas 上下文')

  const quality = params.quality / 100
  renderToCanvas(ectx, img.width, img.height, img, key)

  if (params.format === 'png') {
    const blob = await new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas toBlob 失败'))),
        'image/png',
      )
    })
    return { blob, ext: 'png' }
  } else {
    const blob = await new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas toBlob 失败'))),
        'image/jpeg',
        quality,
      )
    })
    const finalBlob = await injectExifToJpeg(blob, originalBuffer)
    return { blob: finalBlob, ext: 'jpg' }
  }
}

// 重置参数
function resetParams(): void {
  Object.assign(params, DEFAULT_PARAMS)
  const img = currentImage.value
  if (img) {
    params.wmKey = img.wmKey
  } else {
    params.wmKey = ''
  }
}

// ==================== composable ====================

export function useWatermark() {
  return {
    imageList,
    currentIndex,
    currentImage,
    currentWmKey,
    currentBrandKey,
    watermarks,
    watermarkLoaded,
    params,
    status,
    progress,
    error,
    preloadWatermarks,
    addFiles,
    addImageFromDataURL,
    selectImage,
    removeImage,
    clearList,
    renderToCanvas,
    exportImageDataURL,
    exportImageBlob,
    resetParams,
  }
}
