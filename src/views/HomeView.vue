<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import JSZip from 'jszip'
import ThumbPanel from '@/components/ThumbPanel.vue'
import PreviewPanel from '@/components/PreviewPanel.vue'
import ControlToolbar from '@/components/ControlToolbar.vue'
import LutPanel from '@/components/LutPanel.vue'
import ExportPanel from '@/components/ExportPanel.vue'
import { useWatermark } from '@/composables/useWatermark'
import {
  drawWatermark,
  isNativeApp,
  isIOS,
  postToNative,
  makeOutputName,
  downloadBlob,
} from '@/utils'
import { exportComposedBlob } from '@/utils/exportWithLut'
import { getLutData } from '@/constants/luts'
import type { ExportFormat } from '@/types'

const {
  imageList,
  currentIndex,
  currentImage,
  currentWmKey,
  currentBrandKey,
  watermarks,
  params: wmParams,
  status,
  progress,
  error,
  preloadWatermarks,
  addFiles,
  addImageFromDataURL,
  selectImage,
  removeImage,
  resetParams,
} = useWatermark()

const fileInputRef = ref<HTMLInputElement | null>(null)
const previewRef = ref<InstanceType<typeof PreviewPanel> | null>(null)
const isExporting = ref(false)

// 当前激活的工作栏: 'lut' | 'watermark' | 'export'，默认停在调色
const activeTab = ref<'lut' | 'watermark' | 'export'>('lut')

// ==================== 预览渲染 ====================

/**
 * 水印绘制函数（只画水印，不画原图 —— 原图由 WebGL LUT 层负责）
 * 传给 PreviewPanel 用于上层 canvas 画水印
 */
function renderWatermark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const wmKey = currentImage.value?.wmKey ?? ''
  const wmImg = wmKey ? watermarks.value[wmKey] : null
  if (!wmImg) return

  // eslint-disable-next-line no-undef
  ctx.globalCompositeOperation = wmParams.blendMode as GlobalCompositeOperation
  ctx.globalAlpha = wmParams.opacity / 100
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  drawWatermark(ctx, wmImg, w, h, wmParams.fitMode, wmParams.scale, wmParams.posX, wmParams.posY)

  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

// 水印参数变化 → 只重绘水印层（性能好）
watch(
  [
    () => wmParams.blendMode,
    () => wmParams.fitMode,
    () => wmParams.opacity,
    () => wmParams.scale,
    () => wmParams.posX,
    () => wmParams.posY,
  ],
  () => {
    nextTick(() => {
      previewRef.value?.refreshWatermark()
    })
  },
)

// 当前水印 key 变化 → 重绘水印层
watch(currentWmKey, () => {
  nextTick(() => {
    previewRef.value?.refreshWatermark()
  })
})

// 选中图片变化时，完整重新渲染
watch(currentImage, () => {
  nextTick(() => {
    previewRef.value?.render()
  })
})

// ==================== 交互 ====================

function handlePick(): void {
  if (isNativeApp()) {
    postToNative('pickImage')
  } else if (fileInputRef.value) {
    fileInputRef.value.click()
  }
}

function handleFileChange(e: Event): void {
  const target = e.target as HTMLInputElement
  if (target.files && target.files.length) {
    status.value = ''
    error.value = ''
    addFiles(target.files)
  }
  target.value = ''
}

function handleRemove(index: number): void {
  removeImage(index)
}

// ==================== 导出 ====================

/**
 * 导出单张图片（LUT + 水印 合成）
 */
async function handleDownload(): Promise<void> {
  if (currentIndex.value < 0 || !currentImage.value) {
    alert('请先上传并选中一张图片')
    return
  }

  const item = currentImage.value
  error.value = ''
  progress.value = `正在生成图片：${item.name}`

  try {
    await new Promise((r) => setTimeout(r, 0))

    const wmKey = item.wmKey
    const wmImg = wmKey ? watermarks.value[wmKey] : null
    const lut = item.lutId ? getLutData(item.lutId) : null
    const intensity = lut ? item.lutIntensity / 100 : 0

    const { blob, ext } = await exportComposedBlob({
      img: item.img,
      originalBuffer: item.originalBuffer,
      lut,
      intensity,
      lutMode: item.lutMode,
      watermarkImg: wmImg,
      blendMode: wmParams.blendMode,
      fitMode: wmParams.fitMode,
      opacity: wmParams.opacity,
      scale: wmParams.scale,
      posX: wmParams.posX,
      posY: wmParams.posY,
      format: wmParams.format as ExportFormat,
      quality: wmParams.quality / 100,
    })

    const outName = makeOutputName(item.name, ext)

    if (isNativeApp()) {
      const reader = new FileReader()
      reader.onload = () => {
        postToNative('saveImage', { dataURL: reader.result as string, filename: outName })
      }
      reader.readAsDataURL(blob)
      return
    }

    downloadBlob(blob, outName)
    progress.value = '✅ 已开始下载'

    if (isIOS()) {
      setTimeout(() => {
        alert('如果没有自动保存，请长按图片选择「添加到照片」')
      }, 500)
    }
  } catch (e) {
    console.error(e)
    error.value = `导出失败：${(e as Error).message}`
  } finally {
    setTimeout(() => {
      status.value = ''
      progress.value = ''
      error.value = ''
    }, 2000)
  }
}

/**
 * 批量导出（ZIP）— 每张图应用 LUT + 自己的水印
 */
async function handleDownloadAll(): Promise<void> {
  if (imageList.value.length === 0) {
    alert('请先上传图片')
    return
  }

  isExporting.value = true
  error.value = ''

  try {
    const zip = new JSZip()
    const total = imageList.value.length

    for (let i = 0; i < total; i++) {
      const item = imageList.value[i]
      progress.value = `正在处理 ${i + 1}/${total}：${item.name}`

      const wmKey = item.wmKey
      const wmImg = wmKey ? watermarks.value[wmKey] : null
      const itemLut = item.lutId ? getLutData(item.lutId) : null
      const itemIntensity = itemLut ? item.lutIntensity / 100 : 0

      const { blob, ext } = await exportComposedBlob({
        img: item.img,
        originalBuffer: item.originalBuffer,
        lut: itemLut,
        intensity: itemIntensity,
        lutMode: item.lutMode,
        watermarkImg: wmImg,
        blendMode: wmParams.blendMode,
        fitMode: wmParams.fitMode,
        opacity: wmParams.opacity,
        scale: wmParams.scale,
        posX: wmParams.posX,
        posY: wmParams.posY,
        format: wmParams.format as ExportFormat,
        quality: wmParams.quality / 100,
      })

      const outName = makeOutputName(item.name, ext)
      zip.file(outName, blob)

      await new Promise((r) => setTimeout(r, 0))
    }

    progress.value = '正在生成 ZIP 文件...'
    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      progress.value = `正在生成 ZIP 文件... ${metadata.percent.toFixed(1)}%`
    })

    const zipName = 'image-toolbox-batch.zip'
    if (isNativeApp()) {
      const reader = new FileReader()
      reader.onload = () => {
        postToNative('saveImage', { dataURL: reader.result as string, filename: zipName })
      }
      reader.readAsDataURL(zipBlob)
    } else {
      downloadBlob(zipBlob, zipName)
    }

    progress.value = `✅ 已打包 ${total} 张图片`
  } catch (e) {
    console.error(e)
    error.value = `批量导出失败：${(e as Error).message}`
  } finally {
    isExporting.value = false
  }
}

// ==================== 水印面板事件 ====================

function handleReset(): void {
  resetParams()
  nextTick(() => {
    previewRef.value?.refreshWatermark()
  })
}

function handleUpdateWmKey(wmKey: string): void {
  currentWmKey.value = wmKey
}

function handleUpdateBrandKey(brandKey: string): void {
  currentBrandKey.value = brandKey
}

function handleUpdateParams(updates: Record<string, unknown>): void {
  Object.assign(wmParams, updates)
}

// 导出格式/质量变化（来自 ExportPanel）
function handleFormatChange(val: ExportFormat): void {
  wmParams.format = val
}

function handleQualityChange(val: number): void {
  wmParams.quality = val
}

// LUT 面板变化事件
function handleLutChange(): void {
  // LUT 参数变化时 PreviewPanel 内部已经 watch 了，这里预留
}

// ==================== 生命周期 ====================

onMounted(() => {
  preloadWatermarks()

  if (typeof window !== 'undefined') {
    ;(
      window as unknown as { __onImagePicked: (dataURL: string, fileName: string) => void }
    ).__onImagePicked = (dataURL: string, fileName: string) => {
      status.value = ''
      error.value = ''
      addImageFromDataURL(dataURL, fileName || 'image.jpg')
    }
  }
})
</script>

<template>
  <div class="container">
    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      style="display: none"
      @change="handleFileChange"
    />

    <!-- 上半部分（50%）：预览区 + 缩略图 -->
    <div class="top-section">
      <!-- 全局状态：status=中性提示（加载/上限），error=真错误（导出失败） -->
      <div v-if="error" class="global-status error">{{ error }}</div>
      <div v-else-if="status" class="global-status">{{ status }}</div>
      <PreviewPanel
        ref="previewRef"
        :current-image="currentImage"
        :render-watermark="renderWatermark"
      />
      <ThumbPanel
        :image-list="imageList"
        :current-index="currentIndex"
        @select="selectImage"
        @remove="handleRemove"
        @add="handlePick"
      />
    </div>

    <!-- 下半部分（50%）：三步工作区 -->
    <div class="bottom-section">
      <div class="tab-bar">
        <button
          class="tab-item"
          :class="{ active: activeTab === 'lut' }"
          @click="activeTab = 'lut'"
        >
          调色
        </button>
        <button
          class="tab-item"
          :class="{ active: activeTab === 'watermark' }"
          @click="activeTab = 'watermark'"
        >
          水印
        </button>
        <button
          class="tab-item"
          :class="{ active: activeTab === 'export' }"
          @click="activeTab = 'export'"
        >
          导出
        </button>
      </div>

      <div class="tab-content">
        <!-- ① 调色 -->
        <div v-show="activeTab === 'lut'" class="tab-pane">
          <LutPanel :has-current-image="!!currentImage" @change="handleLutChange" />
        </div>

        <!-- ② 水印 -->
        <div v-show="activeTab === 'watermark'" class="tab-pane">
          <ControlToolbar
            :wm-key="currentWmKey"
            :brand-key="currentBrandKey"
            :params="wmParams"
            :has-current-image="!!currentImage"
            @update:wm-key="handleUpdateWmKey"
            @update:brand-key="handleUpdateBrandKey"
            @update:params="handleUpdateParams"
            @reset="handleReset"
          />
        </div>

        <!-- ③ 导出 -->
        <div v-show="activeTab === 'export'" class="tab-pane">
          <ExportPanel
            :format="wmParams.format"
            :quality="wmParams.quality"
            :image-count="imageList.length"
            :has-current-image="!!currentImage"
            :is-exporting="isExporting"
            :status="status"
            :progress="progress"
            :error="error"
            @update:format="handleFormatChange"
            @update:quality="handleQualityChange"
            @download="handleDownload"
            @download-all="handleDownloadAll"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 上下各 50% 布局（基于 100dvh 的 .container） */
.top-section {
  flex: 0 0 50%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

.global-status {
  flex-shrink: 0;
  font-size: 12px;
  color: #007aff;
  text-align: center;
  padding: 4px 0;
  min-height: 20px;
}

.global-status.error {
  color: #ff3b30;
}

.bottom-section {
  flex: 1;
  min-height: 0;
  background: #fafafa;
  border: 1px solid #eee;
  border-radius: 10px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Tab 栏 */
.tab-bar {
  flex-shrink: 0;
  display: flex;
  gap: 4px;
  padding: 6px 8px 0 8px;
  border-bottom: 1px solid #eee;
  background: #fff;
  border-radius: 10px 10px 0 0;
}

.tab-item {
  flex: 1;
  padding: 10px 12px;
  background: transparent;
  color: #666;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
  font-weight: 500;
}

.tab-item:hover {
  background: #f5f5f5;
  color: #333;
}

.tab-item.active {
  color: #007aff;
  border-bottom-color: #007aff;
  background: transparent;
}

/* Tab 内容区（仅内容区滚动） */
.tab-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 14px 14px 14px;
  -webkit-overflow-scrolling: touch;
}

.tab-pane {
  width: 100%;
}

/* 移动端 / 矮屏适配 */
@media (max-width: 640px) {
  .top-section {
    flex: 0 0 48%;
  }

  .tab-item {
    padding: 8px 6px;
    font-size: 13px;
  }

  .tab-content {
    padding: 8px 10px 12px 10px;
  }
}

/* 很矮视口：下区最小高度兜底 */
@media (max-height: 560px) {
  .top-section {
    flex: 0 0 45%;
  }

  .tab-item {
    padding: 6px 8px;
    font-size: 12px;
  }
}
</style>
