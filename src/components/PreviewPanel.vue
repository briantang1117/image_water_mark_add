<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import type { ImageItem } from '@/types'

const props = defineProps<{
  currentImage: ImageItem | null
  renderFn: (ctx: CanvasRenderingContext2D, w: number, h: number, img: HTMLImageElement) => void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const showCanvas = ref(false)

function render(): void {
  if (!props.currentImage || !canvasRef.value) return
  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const { img } = props.currentImage
  canvas.width = img.width
  canvas.height = img.height
  showCanvas.value = true

  props.renderFn(ctx, img.width, img.height, img)
}

watch(
  () => props.currentImage,
  (val) => {
    if (!val) {
      showCanvas.value = false
      return
    }
    // 等待 DOM 更新后渲染
    requestAnimationFrame(render)
  },
  { immediate: true },
)

onMounted(() => {
  if (props.currentImage) {
    render()
  }
})

// 暴露 render 方法给父组件
defineExpose({ render })

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
      <canvas ref="canvasRef" :style="{ display: showCanvas ? 'inline-block' : 'none' }" />
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

canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.placeholder {
  color: #999;
  font-size: 14px;
}
</style>
