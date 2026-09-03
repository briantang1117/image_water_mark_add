<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import type { ImageItem } from '@/types'
import { LutRenderer, isWebGL2Supported } from '@/utils/lutRenderer'
import { useLut } from '@/composables/useLut'

const props = defineProps<{
  currentImage: ImageItem | null
  /** 水印绘制函数（在已画好底图的 Canvas2D 上叠加水印） */
  renderWatermark: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}>()

const emit = defineEmits<{
  rendered: []
}>()

const displayCanvasRef = ref<HTMLCanvasElement | null>(null)
const showCanvas = ref(false)
const showOriginal = ref(false)

// 离屏 WebGL renderer（不直接显示，用于生成 LUT 处理后的底图）
let lutRenderer: LutRenderer | null = null
let webglCanvas: HTMLCanvasElement | null = null
// P0-1：WebGL 不可用 / P0-2：图片超限被降采样 —— 对应的提示状态
const lutUnavailable = ref(false)
const downscaledNotice = ref(false)

const { params: lutParams, getCurrentLut } = useLut()

// 格式化尺寸显示
const sizeText = computed(() => {
  if (!props.currentImage) return ''
  const { width, height } = props.currentImage
  const mp = ((width * height) / 1000000).toFixed(1)
  return `${width} × ${height} px (${mp}MP)`
})

// EXIF 显示条目
const exifEntries = computed(() => {
  const exif = props.currentImage?.exif
  if (!exif) return []
  const entries: { label: string; value: string }[] = []
  if (exif.make || exif.model) {
    entries.push({
      label: '相机',
      value: [exif.make, exif.model].filter(Boolean).join(' '),
    })
  }
  if (exif.lens) entries.push({ label: '镜头', value: exif.lens })
  const params = [exif.focalLength, exif.aperture, exif.shutterSpeed, exif.iso]
    .filter(Boolean)
    .join(' · ')
  if (params) entries.push({ label: '参数', value: params })
  if (exif.dateTime) entries.push({ label: '拍摄时间', value: exif.dateTime })
  if (exif.gps) entries.push({ label: 'GPS', value: exif.gps })
  if (exif.software) entries.push({ label: '软件', value: exif.software })
  return entries
})

// 初始化 WebGL 渲染器（离屏）
function initRenderer(): void {
  if (!isWebGL2Supported()) {
    lutUnavailable.value = true
    console.warn('WebGL2 不支持，LUT 调色不可用')
    return
  }
  try {
    webglCanvas = document.createElement('canvas')
    lutRenderer = new LutRenderer(webglCanvas)
  } catch (e) {
    lutUnavailable.value = true
    console.error('初始化 WebGL 渲染器失败:', e)
  }
}

/**
 * 渲染 LUT 到底图（离屏 WebGL）
 * 返回 WebGL canvas（包含 LUT 处理后的图；无 LUT 时返回原图）
 */
function renderLutToOffscreen(): HTMLCanvasElement | null {
  if (!props.currentImage) return null
  const { img, width, height } = props.currentImage

  const lut = getCurrentLut()
  const needLut = !!(lut && lutParams.lutId && lutParams.intensity > 0)
  downscaledNotice.value = false

  // 无 LUT（或浓度 0）／WebGL 不可用 → 直接用原图
  // 注意：WebGL 不可用且选了 LUT 时也走这里，但顶部横幅会明确提示“LUT 未生效”，不静默
  if (!needLut || !lutRenderer || lutUnavailable.value) {
    const tmp = document.createElement('canvas')
    tmp.width = width
    tmp.height = height
    const ctx = tmp.getContext('2d')
    if (ctx) ctx.drawImage(img, 0, 0)
    return tmp
  }

  const intensity = lutParams.intensity / 100
  lutRenderer.uploadImage(img)
  lutRenderer.uploadLut(lut)

  // P0-2：超 GPU 纹理上限时用安全尺寸渲染，回贴时由外层拉伸到原尺寸
  const safe = lutRenderer.getSafeCanvasSize(width, height)
  downscaledNotice.value = safe.width < width || safe.height < height
  lutRenderer.render(safe.width, safe.height, intensity, lutParams.mode)

  return webglCanvas
}

/**
 * 完整渲染：LUT 底图 + 水印 → 显示 canvas
 */
function render(): void {
  if (!props.currentImage || !displayCanvasRef.value) {
    showCanvas.value = false
    return
  }
  showCanvas.value = true

  nextTick(() => {
    const { width, height, img } = props.currentImage!
    const canvas = displayCanvasRef.value!
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 原图模式：直接画原图，跳过 LUT + 水印
    if (showOriginal.value) {
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0)
      emit('rendered')
      return
    }

    if (!lutRenderer && !webglCanvas) {
      initRenderer()
    }

    // 1. LUT 底图（WebGL 离屏渲染）
    const lutCanvas = renderLutToOffscreen()
    if (lutCanvas) {
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(lutCanvas, 0, 0, width, height)
    }

    // 2. 叠加水印（Canvas2D 混合模式完全正确）
    props.renderWatermark(ctx, width, height)

    emit('rendered')
  })
}

/**
 * 仅重绘水印（LUT 不变时复用离屏结果）
 */
function refreshWatermark(): void {
  if (!props.currentImage || !displayCanvasRef.value || !showCanvas.value) return

  const { width, height } = props.currentImage
  const canvas = displayCanvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 重画 LUT 底图
  if (webglCanvas) {
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(webglCanvas, 0, 0, width, height)
  } else {
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(props.currentImage.img, 0, 0)
  }

  // 重画水印
  props.renderWatermark(ctx, width, height)
}

/**
 * LUT 变化时重渲（需要重新跑 WebGL + 重画水印）
 */
function refreshLut(): void {
  if (!props.currentImage || !showCanvas.value) return
  render()
}

/**
 * 切换原图 / 效果图对比
 */
function toggleOriginal(): void {
  showOriginal.value = !showOriginal.value
  render()
}

// 当前图片变化 → 完整重渲染
watch(
  () => props.currentImage,
  (val) => {
    if (!val) {
      showCanvas.value = false
      return
    }
    requestAnimationFrame(render)
  },
  { immediate: true },
)

// LUT 参数变化 → 重渲 LUT + 水印
watch(
  [() => lutParams.lutId, () => lutParams.intensity, () => lutParams.mode],
  () => {
    if (showCanvas.value) {
      requestAnimationFrame(refreshLut)
    }
  },
)

onMounted(() => {
  if (props.currentImage) {
    render()
  }
})

onBeforeUnmount(() => {
  if (lutRenderer) {
    lutRenderer.destroy()
    lutRenderer = null
  }
  webglCanvas = null
})

// 暴露方法给父组件
defineExpose({
  render,
  refreshLut,
  refreshWatermark,
  /**
   * 获取合成后的最终 canvas（用于导出）
   */
  getFinalCanvas(): HTMLCanvasElement | null {
    return displayCanvasRef.value
  },
})
</script>

<template>
  <div class="preview-panel">
    <!-- 图片信息栏 -->
    <div v-if="currentImage" class="info-bar">
      <div class="info-row">
        <span class="info-filename" :title="currentImage.name">{{ currentImage.name }}</span>
        <span class="info-size">{{ sizeText }}</span>
      </div>
      <div v-if="exifEntries.length" class="exif-row">
        <span
          v-for="item in exifEntries"
          :key="item.label"
          class="exif-item"
          :title="`${item.label}: ${item.value}`"
        >
          <span class="exif-label">{{ item.label }}:</span>
          <span class="exif-value">{{ item.value }}</span>
        </span>
      </div>
      <div v-else-if="currentImage" class="exif-empty">无 EXIF 信息</div>
    </div>

    <div class="canvas-wrap">
      <div v-if="!showCanvas" class="placeholder">请先选择图片</div>
      <div v-if="lutUnavailable && showCanvas" class="lut-warn">
        ⚠️ 当前浏览器不支持 WebGL2，LUT 调色不可用（下方为原图，带 LUT 导出已被阻止）
      </div>
      <div v-if="downscaledNotice && showCanvas" class="lut-warn">
        ⚠️ 图片超过 GPU 纹理上限，已降采样渲染（导出效果一致）
      </div>
      <canvas
        v-show="showCanvas"
        ref="displayCanvasRef"
        class="preview-canvas"
      />
      <button
        v-if="showCanvas"
        class="orig-toggle-btn"
        :class="{ active: showOriginal }"
        @click="toggleOriginal"
        :title="showOriginal ? '显示效果' : '显示原图'"
      >
        {{ showOriginal ? '✨ 效果图' : '🖼 原图' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.preview-panel {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-bar {
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  flex-shrink: 0;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.info-filename {
  font-weight: 600;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

.info-size {
  color: #666;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.exif-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}

.exif-item {
  color: #555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.exif-label {
  color: #999;
  margin-right: 4px;
}

.exif-value {
  color: #333;
  font-variant-numeric: tabular-nums;
}

.exif-empty {
  color: #bbb;
  font-size: 12px;
}

.canvas-wrap {
  flex: 1;
  min-height: 0;
  text-align: center;
  background: #f5f5f5;
  padding: 8px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  display: inline-block;
}

.placeholder {
  color: #999;
  font-size: 14px;
}

.canvas-wrap {
  position: relative;
}

.orig-toggle-btn {
  position: absolute;
  right: 16px;
  bottom: 16px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  border: none;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: all 0.15s;
  z-index: 10;
}

.orig-toggle-btn:hover {
  background: rgba(0, 0, 0, 0.8);
  transform: scale(1.03);
}

.lut-warn {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  z-index: 12;
  max-width: 90%;
  background: rgba(255, 149, 0, 0.92);
  color: #fff;
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
  pointer-events: none;
}

.orig-toggle-btn.active {
  background: rgba(255, 149, 0, 0.85);
}

.orig-toggle-btn.active:hover {
  background: rgba(255, 149, 0, 0.95);
}
</style>
