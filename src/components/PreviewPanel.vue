<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
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
</script>

<template>
  <div class="preview-panel">
    <div class="canvas-wrap">
      <div v-if="!showCanvas" class="placeholder">请先选择图片</div>
      <canvas ref="canvasRef" :style="{ display: showCanvas ? 'inline-block' : 'none' }" />
    </div>
  </div>
</template>

<style scoped>
.preview-panel {
  flex: 1;
  min-width: 0;
}

.canvas-wrap {
  text-align: center;
  background: #fafafa;
  padding: 16px;
  border-radius: 8px;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

canvas {
  max-width: 100%;
  max-height: 70vh;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.placeholder {
  color: #999;
  font-size: 14px;
}
</style>
