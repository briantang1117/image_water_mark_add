<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  BRANDS,
  BLEND_MODE_OPTIONS,
  FORMAT_OPTIONS,
} from '@/constants'

const props = defineProps<{
  params: {
    wmKey: string
    blendMode: string
    fitMode: string
    opacity: number
    scale: number
    posX: number
    posY: number
    format: string
    quality: number
  }
  isExporting: boolean
}>()

const emit = defineEmits<{
  'update:params': [params: Record<string, unknown>]
  pick: []
  clear: []
  download: []
  downloadAll: []
  reset: []
}>()

// 从 wmKey 解析品牌 key
function extractBrandKey(wmKey: string): string {
  return wmKey.split('/')[0] ?? ''
}

// 当前选中的品牌 key（与 params.wmKey 双向同步）
const currentBrandKey = ref(extractBrandKey(props.params.wmKey))

// 监听外部 wmKey 变化，同步品牌
watch(
  () => props.params.wmKey,
  (newKey) => {
    const brand = extractBrandKey(newKey)
    if (brand && brand !== currentBrandKey.value) {
      currentBrandKey.value = brand
    }
  },
)

// 当前品牌下的水印列表
const currentBrandWatermarks = computed(() => {
  const brand = BRANDS.find((b) => b.key === currentBrandKey.value)
  return brand?.watermarks ?? []
})

function updateParam(key: string, value: unknown): void {
  emit('update:params', { [key]: value })
}

// 切换品牌
function handleBrandChange(e: Event): void {
  const brandKey = (e.target as HTMLSelectElement).value
  currentBrandKey.value = brandKey
  // 自动选中该品牌的第一个水印
  const brand = BRANDS.find((b) => b.key === brandKey)
  if (brand && brand.watermarks.length > 0) {
    updateParam('wmKey', brand.watermarks[0].value)
  }
}

const isJpeg = computed(() => props.params.format === 'jpeg')
</script>

<template>
  <div class="toolbar">
    <div class="row">
      <label>
        选择图片：
        <button class="secondary" @click="emit('pick')">选择多张图片</button>
      </label>
      <button class="secondary" @click="emit('clear')">清空列表</button>
    </div>

    <div class="row">
      <label>
        品牌：
        <select :value="currentBrandKey" @change="handleBrandChange">
          <option v-for="brand in BRANDS" :key="brand.key" :value="brand.key">
            {{ brand.label }}
          </option>
        </select>
      </label>
      <label>
        水印：
        <select
          :value="params.wmKey"
          @change="updateParam('wmKey', ($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="opt in currentBrandWatermarks"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label>
        混合模式：
        <select
          :value="params.blendMode"
          @change="updateParam('blendMode', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="opt in BLEND_MODE_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <div class="slider-group">
        <span>不透明度：</span>
        <input
          type="range"
          min="0"
          max="100"
          :value="params.opacity"
          @input="updateParam('opacity', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="slider-val">{{ params.opacity }}%</span>
      </div>
      <div class="slider-group">
        <span>水印大小：</span>
        <input
          type="range"
          min="10"
          max="200"
          :value="params.scale"
          @input="updateParam('scale', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="slider-val">{{ params.scale }}%</span>
      </div>
    </div>
    <div class="row">
      <label>
        导出格式：
        <select
          :value="params.format"
          @change="updateParam('format', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="opt in FORMAT_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <div class="slider-group">
        <span>JPG 质量：</span>
        <input
          type="range"
          min="0"
          max="100"
          :value="params.quality"
          :disabled="!isJpeg"
          @input="updateParam('quality', Number(($event.target as HTMLInputElement).value))"
        />
        <input
          type="number"
          min="0"
          max="100"
          :value="params.quality"
          :disabled="!isJpeg"
          style="width: 64px"
          @input="updateParam('quality', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="slider-val">{{ params.quality }}%</span>
      </div>
    </div>

    <div class="row">
      <button @click="emit('download')">下载当前图片</button>
      <button :disabled="isExporting" @click="emit('downloadAll')">
        {{ isExporting ? '处理中...' : '下载全部 (ZIP)' }}
      </button>
      <button class="secondary" @click="emit('reset')">重置参数</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  width: 100%;
}
</style>
