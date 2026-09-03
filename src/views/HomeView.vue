<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import JSZip from 'jszip'
import ThumbPanel from '@/components/ThumbPanel.vue'
import PreviewPanel from '@/components/PreviewPanel.vue'
import ControlToolbar from '@/components/ControlToolbar.vue'
import LutPanel from '@/components/LutPanel.vue'
import { useWatermark } from '@/composables/useWatermark'
import { drawWatermark, isNativeApp, isIOS, postToNative, makeOutputName, downloadBlob } from '@/utils'
import { exportComposedBlob } from '@/utils/exportWithLut'
import { getLutData } from '@/constants/luts'
import { FORMAT_OPTIONS } from '@/constants'
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
  preloadWatermarks,
  addFiles,
  addImageFromDataURL,
  selectImage,
  removeImage,
  clearList,
  resetParams,
} = useWatermark()

const fileInputRef = ref<HTMLInputElement | null>(null)
const previewRef = ref<InstanceType<typeof PreviewPanel> | null>(null)
const isExporting = ref(false)

// 当前激活的 Tab: 'watermark' | 'lut'
const activeTab = ref<'watermark' | 'lut'>('watermark')

// ==================== 预览渲染 ====================

/**
 * 水印绘制函数（只画水印，不画原图 —— 原图由 WebGL LUT 层负责）
 * 传给 PreviewPanel 用于上层 canvas 画水印
 */
function renderWatermark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const wmKey = currentImage.value?.wmKey ?? ''
  const wmImg = wmKey ? watermarks.value[wmKey] : null
  if (!wmImg) return

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
    addFiles(target.files)
  }
  target.value = ''
}

function handleRemove(index: number): void {
  removeImage(index)
}

function handleClear(): void {
  if (imageList.value.length === 0) return
  if (!confirm(`确定清空 ${imageList.value.length} 张图片吗？`)) return
  clearList()
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
  status.value = `正在生成图片：${item.name}`
  progress.value = ''

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
    status.value = `导出失败：${(e as Error).message}`
  } finally {
    setTimeout(() => {
      status.value = ''
      progress.value = ''
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
    status.value = `批量导出失败：${(e as Error).message}`
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

// 顶部导出格式变化
function handleFormatChange(e: Event): void {
  wmParams.format = (e.target as HTMLSelectElement).value
}

function handleQualityChange(e: Event): void {
  wmParams.quality = Number((e.target as HTMLInputElement).value)
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
      addImageFromDataURL(dataURL, fileName || 'image.jpg')
    }
  }
})
</script>

<template>
  <div class="container">
    <h2>
      图片工具箱
      <span style="font-size: 14px; color: #999; font-weight: normal">（水印 + LUT 调色）</span>
    </h2>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      style="display: none"
      @change="handleFileChange"
    />

    <!-- 顶部通用工具栏 -->
    <div class="top-toolbar">
      <button class="primary-btn" @click="handlePick">📷 选择图片</button>
      <button class="secondary-btn" @click="handleClear" :disabled="imageList.length === 0">
        清空列表
      </button>
      <div class="toolbar-divider"></div>
      <label class="top-select">
        格式：
        <select :value="wmParams.format" @change="handleFormatChange">
          <option v-for="opt in FORMAT_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <div v-if="wmParams.format === 'jpeg'" class="top-slider">
        <span>质量：</span>
        <input
          type="range"
          min="0"
          max="100"
          :value="wmParams.quality"
          @input="handleQualityChange"
        />
        <span class="top-slider-val">{{ wmParams.quality }}%</span>
      </div>
      <div class="toolbar-divider"></div>
      <button
        class="download-btn"
        :disabled="!currentImage"
        @click="handleDownload"
      >
        💾 下载当前
      </button>
      <button
        class="download-btn"
        :disabled="imageList.length === 0 || isExporting"
        @click="handleDownloadAll"
      >
        {{ isExporting ? '处理中...' : '📦 下载全部 (ZIP)' }}
      </button>
      <span class="top-toolbar-count">共 {{ imageList.length }} 张</span>
    </div>

    <!-- 上半部分：预览区 + 缩略图 -->
    <div class="preview-section">
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
      />
    </div>

    <div class="status">{{ status }}</div>
    <div class="progress">{{ progress }}</div>

    <!-- 下半部分：Tab 切换面板 -->
    <div class="bottom-section">
      <div class="tab-bar">
        <button
          class="tab-item"
          :class="{ active: activeTab === 'watermark' }"
          @click="activeTab = 'watermark'"
        >
          💧 水印
        </button>
        <button
          class="tab-item"
          :class="{ active: activeTab === 'lut' }"
          @click="activeTab = 'lut'"
        >
          🎨 LUT 调色
        </button>
      </div>

      <div class="tab-content">
        <!-- 水印面板 -->
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

        <!-- LUT 面板 -->
        <div v-show="activeTab === 'lut'" class="tab-pane">
          <LutPanel :has-current-image="!!currentImage" @change="handleLutChange" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 顶部通用工具栏 */
.top-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  margin-bottom: 8px;
}

.primary-btn {
  padding: 8px 16px;
  background: #007aff;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.primary-btn:hover {
  background: #0062cc;
}

.secondary-btn {
  padding: 8px 14px;
  background: #f0f0f0;
  color: #333;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.secondary-btn:hover {
  background: #e0e0e0;
}

.secondary-btn:disabled {
  background: #f5f5f5;
  color: #ccc;
  cursor: not-allowed;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: #e0e0e0;
  margin: 0 4px;
}

.download-btn {
  padding: 8px 14px;
  background: #34c759;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.download-btn:hover {
  background: #28a745;
}

.download-btn:disabled {
  background: #c0c0c0;
  cursor: not-allowed;
}

.top-select {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #555;
}

.top-select select {
  font-size: 12px;
  padding: 3px 6px;
}

.top-slider {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #555;
}

.top-slider input[type='range'] {
  width: 100px;
}

.top-slider-val {
  min-width: 36px;
  text-align: right;
  color: #666;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

.top-toolbar-count {
  margin-left: auto;
  font-size: 12px;
  color: #999;
  font-variant-numeric: tabular-nums;
}

/* 上半部分：预览区 + 缩略图列表 */
.preview-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 下半部分：Tab 面板容器 */
.bottom-section {
  flex-shrink: 0;
  background: #fafafa;
  border: 1px solid #eee;
  border-radius: 10px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  max-height: 45vh;
  min-height: 240px;
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
  padding: 8px 12px;
  background: transparent;
  color: #666;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  font-size: 13px;
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

/* Tab 内容区 */
.tab-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px 12px 12px;
  -webkit-overflow-scrolling: touch;
}

.tab-pane {
  width: 100%;
}

/* 移动端适配 */
@media (max-width: 640px) {
  .top-toolbar {
    gap: 6px 8px;
    font-size: 12px;
  }

  .top-toolbar button {
    padding: 6px 10px;
    font-size: 12px;
  }

  .top-select,
  .top-slider {
    font-size: 11px;
  }

  .top-slider input[type='range'] {
    width: 70px;
  }

  .toolbar-divider {
    display: none;
  }

  .top-toolbar-count {
    width: 100%;
    margin-left: 0;
    text-align: right;
  }

  .bottom-section {
    max-height: 50vh;
    min-height: 200px;
  }

  .tab-item {
    padding: 6px 8px;
    font-size: 12px;
  }
}
</style>
