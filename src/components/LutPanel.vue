<script setup lang="ts">
import { useLut } from '@/composables/useLut'
import { isWebGL2Supported } from '@/utils/lutRenderer'

// P0-1：WebGL2 能力检测——不支持时禁用 LUT 控件并提示，避免“选了配方却没生效”的静默
const lutSupported = isWebGL2Supported()

defineProps<{
  hasCurrentImage: boolean
}>()

const emit = defineEmits<{
  change: []
}>()

const {
  LUT_CATEGORIES,
  currentCategory,
  currentCategoryLuts,
  currentLutId,
  params,
  selectCategory,
  selectLut,
  setIntensity,
  setMode,
  resetParams,
} = useLut()

function handleCategoryChange(e: Event): void {
  selectCategory((e.target as HTMLSelectElement).value)
  emit('change')
}

function handleLutChange(e: Event): void {
  selectLut((e.target as HTMLSelectElement).value)
  emit('change')
}

function handleIntensityChange(e: Event): void {
  setIntensity(Number((e.target as HTMLInputElement).value))
  emit('change')
}

function handleModeChange(mode: 'ps' | 'professional'): void {
  setMode(mode)
  emit('change')
}

function handleReset(): void {
  resetParams()
  emit('change')
}
</script>

<template>
  <div class="lut-panel">
    <!-- WebGL2 不可用提示 -->
    <div v-if="!lutSupported" class="lut-panel-warn">
      ⚠️ 当前浏览器不支持 WebGL2，LUT 调色不可用（预览将显示原图，带 LUT 导出会被阻止）
    </div>

    <!-- 分类 + LUT 选择 -->
    <div class="row">
      <label>
        分类：
        <select
          :value="currentCategory"
          :disabled="!hasCurrentImage || !lutSupported"
          @change="handleCategoryChange"
        >
          <option v-for="cat in LUT_CATEGORIES" :key="cat.key" :value="cat.key">
            {{ cat.label }}
          </option>
        </select>
      </label>
      <label>
        LUT：
        <select
          :value="currentLutId"
          :disabled="!hasCurrentImage || !lutSupported"
          @change="handleLutChange"
        >
          <option value="">无 LUT</option>
          <option
            v-for="lut in currentCategoryLuts"
            :key="lut.value"
            :value="lut.value"
          >
            {{ lut.label }}
          </option>
        </select>
      </label>
    </div>

    <!-- 浓度滑块 + 渲染模式 -->
    <div class="row">
      <div class="slider-group">
        <span>LUT 浓度：</span>
        <input
          type="range"
          min="0"
          max="100"
          :value="params.intensity"
          :disabled="!currentLutId || !lutSupported"
          @input="handleIntensityChange"
        />
        <input
          type="number"
          min="0"
          max="100"
          :value="params.intensity"
          :disabled="!currentLutId || !lutSupported"
          style="width: 56px"
          @input="handleIntensityChange"
        />
        <span class="slider-val">{{ params.intensity }}%</span>
      </div>
      <div class="mode-tabs">
        <button
          class="mode-btn"
          :class="{ active: params.mode === 'professional' }"
          :disabled="!currentLutId || !lutSupported"
          @click="handleModeChange('professional')"
        >
          Rec.709 还原
        </button>
        <button
          class="mode-btn"
          :class="{ active: params.mode === 'ps' }"
          :disabled="!currentLutId || !lutSupported"
          @click="handleModeChange('ps')"
        >
          sRGB 直查
        </button>
      </div>
    </div>

    <!-- 模式说明 -->
    <div v-if="currentLutId && lutSupported" class="mode-hint">
      <template v-if="params.mode === 'professional'">
        💡 Rec.709 还原（默认）：图像先重编码为 Rec.709 显示信号（BT.1886，γ≈2.4）再查表，
        等价达芬奇「dlog → Rec.709 → 套 LUT」的结果。内置配方均按 Rec.709 输入制作。
      </template>
      <template v-else>
        💡 sRGB 直查：直接对 sRGB 像素查表，同 Photoshop「颜色查找」；仅当配方确为 sRGB/PS 生态制作用。
      </template>
    </div>

    <!-- 重置 -->
    <div class="row">
      <button class="secondary" @click="handleReset">重置参数</button>
    </div>
  </div>
</template>

<style scoped>
.lut-panel {
  width: 100%;
  padding: 4px 0;
}

.lut-panel-warn {
  background: #fff3cd;
  border: 1px solid #ffeaa7;
  color: #856404;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 10px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 10px;
  align-items: center;
}

.row label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

select {
  font-size: 13px;
  padding: 4px 6px;
}

.section-label {
  font-size: 13px;
  color: #666;
}

button.secondary {
  padding: 5px 12px;
  cursor: pointer;
  border: none;
  border-radius: 6px;
  background: #f0f0f0;
  color: #333;
  font-size: 13px;
}

button.secondary:hover {
  background: #e0e0e0;
}

button:disabled {
  background: #f5f5f5 !important;
  color: #ccc !important;
  cursor: not-allowed;
}

.slider-group {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.slider-group input[type='range'] {
  width: 140px;
}

.slider-val {
  min-width: 36px;
  text-align: right;
  color: #666;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.mode-tabs {
  display: flex;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
}

.mode-btn {
  padding: 5px 12px;
  background: #fff;
  color: #666;
  border: none;
  font-size: 12px;
  cursor: pointer;
  border-right: 1px solid #e0e0e0;
  transition: all 0.15s;
}

.mode-btn:last-child {
  border-right: none;
}

.mode-btn.active {
  background: #007aff;
  color: #fff;
}

.mode-btn:not(.active):hover {
  background: #f5f5f5;
}

.mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mode-hint {
  font-size: 12px;
  color: #888;
  padding: 6px 10px;
  background: #f7f7f7;
  border-radius: 6px;
  margin-bottom: 10px;
  line-height: 1.5;
}
</style>
