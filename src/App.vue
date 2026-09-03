<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import JSZip from 'jszip'
import ThumbPanel from '@/components/ThumbPanel.vue'
import PreviewPanel from '@/components/PreviewPanel.vue'
import ControlToolbar from '@/components/ControlToolbar.vue'
import LutPanel from '@/components/LutPanel.vue'
import { useWatermark } from '@/composables/useWatermark'
import { isNativeApp, isIOS, postToNative, makeOutputName, downloadBlob } from '@/utils'

const {
  imageList,
  currentIndex,
  currentImage,
  currentWmKey,
  currentBrandKey,
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
  exportImageBlob,
  resetParams,
} = useWatermark()

const fileInputRef = ref<HTMLInputElement | null>(null)
const previewRef = ref<InstanceType<typeof PreviewPanel> | null>(null)
const isExporting = ref(false)

// 当前激活的 Tab: 'watermark' | 'lut'
const activeTab = ref<'watermark' | 'lut'>('watermark')

// 渲染函数传给预览组件（使用当前图片自己的水印）
function renderFn(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  img: HTMLImageElement,
): void {
  const wmKey = currentImage.value?.wmKey ?? ''
  renderToCanvas(ctx, w, h, img, wmKey)
}

// 参数变化时重新渲染预览
watch(
  [
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

// 当前水印 key 变化时重新渲染预览
watch(currentWmKey, () => {
  nextTick(() => {
    previewRef.value?.render()
  })
})

// 选中图片变化时，重新渲染预览
watch(currentImage, () => {
  nextTick(() => {
    previewRef.value?.render()
  })
})

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

// 删除单张图片
function handleRemove(index: number): void {
  removeImage(index)
}

// 清空列表
function handleClear(): void {
  if (imageList.value.length === 0) return
  if (!confirm(`确定清空 ${imageList.value.length} 张图片吗？`)) return
  clearList()
}

// 下载当前图片
async function handleDownload(): Promise<void> {
  if (currentIndex.value < 0 || !currentImage.value) {
    alert('请先上传并选中一张图片')
    return
  }

  const item = currentImage.value
  status.value = `正在生成图片：${item.name}`
  progress.value = ''

  try {
    // 让 UI 先更新状态
    await new Promise((r) => setTimeout(r, 0))

    const { blob, ext } = await exportImageBlob(item.img, item.originalBuffer, item.wmKey)
    const outName = makeOutputName(item.name, ext)

    if (isNativeApp()) {
      const reader = new FileReader()
      reader.onload = () => {
        postToNative('saveImage', { dataURL: reader.result as string, filename: outName })
      }
      reader.readAsDataURL(blob)
      return
    }

    // 浏览器环境：用 Blob + ObjectURL 下载，兼容 iOS
    downloadBlob(blob, outName)
    progress.value = '✅ 已开始下载'

    // iOS 提示用户长按保存
    if (isIOS()) {
      setTimeout(() => {
        alert('如果没有自动保存，请长按图片选择「添加到照片」')
      }, 500)
    }
  } finally {
    // 2 秒后清除提示
    setTimeout(() => {
      status.value = ''
      progress.value = ''
    }, 2000)
  }
}

// 下载全部（ZIP）— 每张图片使用自己的水印配置
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

      const { blob, ext } = await exportImageBlob(item.img, item.originalBuffer, item.wmKey)
      const outName = makeOutputName(item.name, ext)
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
      // 浏览器环境：用统一的 downloadBlob，兼容 iOS
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

// 重置参数
function handleReset(): void {
  resetParams()
}

// 更新水印 key（从工具栏）
function handleUpdateWmKey(wmKey: string): void {
  currentWmKey.value = wmKey
}

// 更新品牌 key（从工具栏）
function handleUpdateBrandKey(brandKey: string): void {
  currentBrandKey.value = brandKey
}

// 更新其他参数（从工具栏）
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
      <span class="top-toolbar-count">共 {{ imageList.length }} 张</span>
    </div>

    <!-- 上半部分：预览区 + 缩略图 -->
    <div class="preview-section">
      <PreviewPanel ref="previewRef" :current-image="currentImage" :render-fn="renderFn" />
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
            :params="params"
            :has-current-image="!!currentImage"
            :is-exporting="isExporting"
            @update:wm-key="handleUpdateWmKey"
            @update:brand-key="handleUpdateBrandKey"
            @update:params="handleUpdateParams"
            @download="handleDownload"
            @download-all="handleDownloadAll"
            @reset="handleReset"
          />
        </div>

        <!-- LUT 面板 -->
        <div v-show="activeTab === 'lut'" class="tab-pane">
          <LutPanel :has-current-image="!!currentImage" />
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
  align-items: center;
  gap: 10px;
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
