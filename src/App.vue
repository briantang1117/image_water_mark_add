<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import JSZip from 'jszip'
import ThumbPanel from '@/components/ThumbPanel.vue'
import PreviewPanel from '@/components/PreviewPanel.vue'
import ControlToolbar from '@/components/ControlToolbar.vue'
import { useWatermark } from '@/composables/useWatermark'
import { isNativeApp, postToNative, makeOutputName, dataURLtoBlob } from '@/utils'

const {
  imageList,
  currentIndex,
  currentImage,
  params,
  status,
  progress,
  preloadWatermarks,
  addFiles,
  addImageFromDataURL,
  selectImage,
  clearList,
  renderToCanvas,
  exportImageDataURL,
  resetParams,
} = useWatermark()

const fileInputRef = ref<HTMLInputElement | null>(null)
const previewRef = ref<InstanceType<typeof PreviewPanel> | null>(null)
const isExporting = ref(false)

// 渲染函数传给预览组件
function renderFn(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  img: HTMLImageElement,
): void {
  renderToCanvas(ctx, w, h, img)
}

// 参数变化时重新渲染预览
watch(
  [
    () => params.wmKey,
    () => params.blendMode,
    () => params.fitMode,
    () => params.opacity,
    () => params.scale,
    () => params.posX,
    () => params.posY,
    () => params.format,
    () => params.quality,
  ],
  () => {
    nextTick(() => {
      previewRef.value?.render()
    })
  },
)

// 选择图片按钮
function handlePick(): void {
  if (isNativeApp()) {
    postToNative('pickImage')
  } else if (fileInputRef.value) {
    fileInputRef.value.click()
  }
}

// 文件选择变化
function handleFileChange(e: Event): void {
  const target = e.target as HTMLInputElement
  if (target.files && target.files.length) {
    status.value = ''
    addFiles(target.files)
  }
  // 允许重复选择同一文件
  target.value = ''
}

// 清空列表
function handleClear(): void {
  if (imageList.value.length === 0) return
  if (!confirm(`确定清空 ${imageList.value.length} 张图片吗？`)) return
  clearList()
}

// 下载当前图片
function handleDownload(): void {
  if (currentIndex.value < 0 || !currentImage.value) {
    alert('请先上传并选中一张图片')
    return
  }

  const item = currentImage.value
  const { dataURL, ext } = exportImageDataURL(item.img)
  const outName = makeOutputName(item.name, ext)

  if (isNativeApp()) {
    postToNative('saveImage', { dataURL, filename: outName })
  } else {
    const link = document.createElement('a')
    link.download = outName
    link.href = dataURL
    link.click()
  }
}

// 下载全部（ZIP）
async function handleDownloadAll(): Promise<void> {
  if (imageList.value.length === 0) {
    alert('请先上传图片')
    return
  }

  isExporting.value = true

  try {
    const zip = new JSZip()
    const total = imageList.value.length

    for (let i = 0; i < total; i++) {
      const item = imageList.value[i]
      progress.value = `正在处理 ${i + 1}/${total}：${item.name}`

      const { dataURL, ext } = exportImageDataURL(item.img)
      const outName = makeOutputName(item.name, ext)
      const blob = dataURLtoBlob(dataURL)
      zip.file(outName, blob)

      // 让 UI 有机会更新
      await new Promise((r) => setTimeout(r, 0))
    }

    progress.value = '正在生成 ZIP 文件...'
    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      progress.value = `正在生成 ZIP 文件... ${metadata.percent.toFixed(1)}%`
    })

    const zipName = 'watermark-batch.zip'
    if (isNativeApp()) {
      // 原生环境：将 zip 转为 base64 交给原生
      const reader = new FileReader()
      reader.onload = () => {
        postToNative('saveImage', { dataURL: reader.result as string, filename: zipName })
      }
      reader.readAsDataURL(zipBlob)
    } else {
      const url = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = zipName
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    progress.value = `✅ 已打包 ${total} 张图片`
  } catch (e) {
    console.error(e)
    status.value = `批量导出失败：${(e as Error).message}`
  } finally {
    isExporting.value = false
  }
}

// 重置参数
function handleReset(): void {
  resetParams()
}

// 更新 params（从工具栏）
function handleUpdateParams(updates: Record<string, unknown>): void {
  Object.assign(params, updates)
}

// 原生 app 回调
onMounted(() => {
  // 预加载水印
  preloadWatermarks()

  // 注册原生回调
  if (typeof window !== 'undefined') {
    ;(
      window as unknown as { __onImagePicked: (dataURL: string, fileName: string) => void }
    ).__onImagePicked = (dataURL: string, fileName: string) => {
      status.value = ''
      addImageFromDataURL(dataURL, fileName || 'image.jpg')
    }
  }
})
</script>

<template>
  <div class="container">
    <h2>
      水印叠加工具
      <span style="font-size: 14px; color: #999; font-weight: normal">（批量版）</span>
    </h2>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      style="display: none"
      @change="handleFileChange"
    />

    <ControlToolbar
      :params="params"
      :is-exporting="isExporting"
      @update:params="handleUpdateParams"
      @pick="handlePick"
      @clear="handleClear"
      @download="handleDownload"
      @download-all="handleDownloadAll"
      @reset="handleReset"
    />

    <div class="status">{{ status }}</div>
    <div class="progress">{{ progress }}</div>

    <div class="main-layout">
      <ThumbPanel :image-list="imageList" :current-index="currentIndex" @select="selectImage" />
      <PreviewPanel ref="previewRef" :current-image="currentImage" :render-fn="renderFn" />
    </div>
  </div>
</template>
