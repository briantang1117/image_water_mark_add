<script setup lang="ts">
import { computed } from 'vue'
import { BRANDS, BLEND_MODE_OPTIONS } from '@/constants'

const props = defineProps<{
  wmKey: string
  brandKey: string
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
  hasCurrentImage: boolean
}>()

const emit = defineEmits<{
  'update:wmKey': [wmKey: string]
  'update:brandKey': [brandKey: string]
  'update:params': [params: Record<string, unknown>]
  reset: []
}>()

// 当前品牌下的水印列表
const currentBrandWatermarks = computed(() => {
  const brand = BRANDS.find((b) => b.key === props.brandKey)
  return brand?.watermarks ?? []
})

function updateParam(key: string, value: unknown): void {
  emit('update:params', { [key]: value })
}

// 切换品牌
function handleBrandChange(e: Event): void {
  const brandKey = (e.target as HTMLSelectElement).value
  emit('update:brandKey', brandKey)
}

// 切换水印
function handleWmChange(e: Event): void {
  const wmKey = (e.target as HTMLSelectElement).value
  emit('update:wmKey', wmKey)
}
</script>

<template>
  <div class="toolbar">
    <div class="row">
      <label>
        品牌：
        <select :value="brandKey" :disabled="!hasCurrentImage" @change="handleBrandChange">
          <option v-for="brand in BRANDS" :key="brand.key" :value="brand.key">
            {{ brand.label }}
          </option>
        </select>
      </label>
      <label>
        水印：
        <select :value="wmKey" :disabled="!hasCurrentImage" @change="handleWmChange">
          <option value="">无水印</option>
          <option v-for="opt in currentBrandWatermarks" :key="opt.value" :value="opt.value">
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
      <button class="secondary" @click="emit('reset')">重置参数</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  width: 100%;
}
</style>
