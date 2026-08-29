import { computed, reactive, ref } from 'vue'
import type { ImageItem, WatermarkMap } from '@/types'
import { drawWatermark, loadImageFromDataURL, loadImageFromFile, loadWatermark } from '@/utils'
import { loadLastSelection } from '@/utils/storage'
import { DEFAULT_PARAMS, WATERMARK_SOURCES, BRANDS, DEFAULT_BRAND_KEY } from '@/constants'

export function useWatermark() {
  const imageList = ref<ImageItem[]>([])
  const currentIndex = ref(-1)
  let nextId = 1

  const watermarks = ref<WatermarkMap>({})
  const watermarkLoaded = reactive<Record<string, boolean>>({})

  const params = reactive({ ...DEFAULT_PARAMS })
  const brandKey = ref(DEFAULT_BRAND_KEY)

  // 从 wmKey 解析品牌 key
  function extractBrandFromWmKey(wmKey: string): string {
    return wmKey.split('/')[0] ?? DEFAULT_BRAND_KEY
  }

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
        const { img, thumbDataURL, name } = await loadImageFromFile(file)
        imageList.value.push({
          id: nextId++,
          name,
          img,
          thumbDataURL,
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
      const { img, thumbDataURL, name } = await loadImageFromDataURL(dataURL, fileName)
      imageList.value.push({
        id: nextId++,
        name,
        img,
        thumbDataURL,
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
  }

  // 删除单张图片
  function removeImage(index: number): void {
    if (index < 0 || index >= imageList.value.length) return
    imageList.value.splice(index, 1)

    // 调整当前选中索引
    if (imageList.value.length === 0) {
      currentIndex.value = -1
    } else if (index === currentIndex.value) {
      // 删除的是当前选中的，选中前一张（或后一张）
      currentIndex.value = Math.min(index, imageList.value.length - 1)
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
    status.value = ''
    progress.value = ''
  }

  // 渲染到指定 canvas
  function renderToCanvas(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    img: HTMLImageElement,
  ): void {
    const watermarkImg = watermarks.value[params.wmKey]
    if (!watermarkImg) {
      return
    }

    ctx.clearRect(0, 0, canvasW, canvasH)

    // JPG 导出时铺白底
    if (params.format === 'jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvasW, canvasH)
    }

    ctx.drawImage(img, 0, 0)

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
  function exportImageDataURL(img: HTMLImageElement): {
    dataURL: string
    ext: string
  } {
    const watermarkImg = watermarks.value[params.wmKey]
    if (!watermarkImg) throw new Error('水印未加载')

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = img.width
    exportCanvas.height = img.height
    const ectx = exportCanvas.getContext('2d')
    if (!ectx) throw new Error('无法创建 canvas 上下文')

    const quality = params.quality / 100

    renderToCanvas(ectx, img.width, img.height, img)

    if (params.format === 'png') {
      return { dataURL: exportCanvas.toDataURL('image/png'), ext: 'png' }
    } else {
      return { dataURL: exportCanvas.toDataURL('image/jpeg', quality), ext: 'jpg' }
    }
  }

  // 从缓存初始化品牌和水印选择
  function initFromCache(): void {
    const cached = loadLastSelection()
    if (cached.wmKey) {
      params.wmKey = cached.wmKey
      brandKey.value = extractBrandFromWmKey(cached.wmKey)
    } else if (cached.brandKey) {
      // 只有品牌缓存时，选中该品牌的第一个水印
      const brand = BRANDS.find((b) => b.key === cached.brandKey)
      if (brand && brand.watermarks.length > 0) {
        brandKey.value = brand.key
        params.wmKey = brand.watermarks[0].value
      }
    }
  }

  // 重置参数（保留品牌和水印选择）
  function resetParams(): void {
    const currentWmKey = params.wmKey
    Object.assign(params, DEFAULT_PARAMS)
    params.wmKey = currentWmKey
    // brandKey 也保持不变
  }

  return {
    imageList,
    currentIndex,
    currentImage,
    watermarks,
    watermarkLoaded,
    params,
    brandKey,
    status,
    progress,
    preloadWatermarks,
    initFromCache,
    addFiles,
    addImageFromDataURL,
    selectImage,
    removeImage,
    clearList,
    renderToCanvas,
    exportImageDataURL,
    resetParams,
  }
}
