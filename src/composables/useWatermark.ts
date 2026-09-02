import { computed, reactive, ref } from 'vue'
import type { ImageItem, WatermarkMap } from '@/types'
import {
  autoDetectWatermark,
  drawWatermark,
  injectExifToJpeg,
  loadImageFromDataURL,
  loadImageFromFile,
  loadWatermark,
} from '@/utils'
import { DEFAULT_PARAMS, WATERMARK_SOURCES, BRANDS, DEFAULT_BRAND_KEY } from '@/constants'

export function useWatermark() {
  const imageList = ref<ImageItem[]>([])
  const currentIndex = ref(-1)
  let nextId = 1

  const watermarks = ref<WatermarkMap>({})
  const watermarkLoaded = reactive<Record<string, boolean>>({})

  // 全局渲染参数（混合模式、不透明度、大小、位置、导出格式等）
  // 注意：wmKey 不再是全局的，每张图片有独立的 wmKey
  const params = reactive({ ...DEFAULT_PARAMS })

  // 当前选中图片的 wmKey（计算属性，与 params.wmKey 双向同步）
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
      // 同时同步到 params.wmKey，保持兼容
      params.wmKey = val
    },
  })

  // 从 wmKey 解析品牌 key
  function extractBrandFromWmKey(wmKey: string): string {
    return wmKey.split('/')[0] ?? DEFAULT_BRAND_KEY
  }

  // 当前品牌 key（基于当前选中图片的水印）
  const currentBrandKey = computed({
    get(): string {
      const wmKey = currentWmKey.value
      if (!wmKey) return DEFAULT_BRAND_KEY
      return extractBrandFromWmKey(wmKey)
    },
    set(brandKey: string) {
      // 切换品牌时，选中该品牌的第一个横屏水印
      const brand = BRANDS.find((b) => b.key === brandKey)
      if (brand && brand.watermarks.length > 0) {
        // 优先选横屏的第一个
        const firstLandscape = brand.watermarks.find((w) => w.value.endsWith('-横屏'))
        currentWmKey.value = firstLandscape?.value ?? brand.watermarks[0].value
      }
    },
  })

  const status = ref('')
  const progress = ref('')

  const currentImage = computed(() => {
    if (currentIndex.value < 0 || currentIndex.value >= imageList.value.length) return null
    return imageList.value[currentIndex.value]
  })

  // 预加载所有水印（从 WATERMARK_SOURCES 动态读取）
  async function preloadWatermarks(): Promise<void> {
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
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return

    status.value = `正在加载 ${files.length} 张图片...`
    progress.value = ''

    let loaded = 0
    for (const file of files) {
      try {
        const { img, thumbDataURL, name, width, height, exif, originalBuffer } =
          await loadImageFromFile(file)

        // 自动检测水印
        const wmKey = autoDetectWatermark(exif, width, height)

        imageList.value.push({
          id: nextId++,
          name,
          img,
          thumbDataURL,
          width,
          height,
          exif,
          originalBuffer,
          wmKey,
        })
        loaded++
        status.value = `正在加载... ${loaded}/${files.length}`
      } catch (e) {
        console.error('加载失败:', file.name, e)
      }
    }

    status.value = ''

    // 如果之前没有选中，默认选中第一张新增的
    if (currentIndex.value < 0 && imageList.value.length > 0) {
      selectImage(0)
    }
  }

  // 从 dataURL 添加一张图片（原生 app 回调）
  async function addImageFromDataURL(dataURL: string, fileName: string): Promise<void> {
    try {
      const { img, thumbDataURL, name, width, height, exif, originalBuffer } =
        await loadImageFromDataURL(dataURL, fileName)

      // 自动检测水印
      const wmKey = autoDetectWatermark(exif, width, height)

      imageList.value.push({
        id: nextId++,
        name,
        img,
        thumbDataURL,
        width,
        height,
        exif,
        originalBuffer,
        wmKey,
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
    // 同步 params.wmKey 到当前图片的 wmKey（用于工具栏显示）
    const img = imageList.value[index]
    params.wmKey = img.wmKey
  }

  // 删除单张图片
  function removeImage(index: number): void {
    if (index < 0 || index >= imageList.value.length) return
    imageList.value.splice(index, 1)

    // 调整当前选中索引
    if (imageList.value.length === 0) {
      currentIndex.value = -1
      params.wmKey = ''
    } else if (index === currentIndex.value) {
      // 删除的是当前选中的，选中前一张（或后一张）
      currentIndex.value = Math.min(index, imageList.value.length - 1)
      params.wmKey = imageList.value[currentIndex.value].wmKey
    } else if (index < currentIndex.value) {
      // 删除的在当前选中前面，索引减一
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
  }

  // 渲染到指定 canvas（使用指定 wmKey，空字符串表示不绘制水印）
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

    // JPG 导出时铺白底
    if (params.format === 'jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvasW, canvasH)
    }

    ctx.drawImage(img, 0, 0)

    // 无水印时直接返回
    if (!watermarkImg) {
      return
    }

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

  // 导出图片为 Blob（JPEG 时会写回原始 EXIF）
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
      // JPEG：注入原始 EXIF
      const finalBlob = await injectExifToJpeg(blob, originalBuffer)
      return { blob: finalBlob, ext: 'jpg' }
    }
  }

  // 重置参数
  function resetParams(): void {
    Object.assign(params, DEFAULT_PARAMS)
    // 重置后同步当前图片的 wmKey 到 params
    const img = currentImage.value
    if (img) {
      params.wmKey = img.wmKey
    } else {
      params.wmKey = ''
    }
  }

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
