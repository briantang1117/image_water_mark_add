<script setup lang="ts">
import { computed } from 'vue'
import { FORMAT_OPTIONS } from '@/constants'
import type { ExportFormat } from '@/types'

const props = defineProps<{
  format: string
  quality: number
  imageCount: number
  hasCurrentImage: boolean
  isExporting: boolean
  progress: string
  error: string
}>()

const emit = defineEmits<{
  'update:format': [value: ExportFormat]
  'update:quality': [value: number]
  download: []
  downloadAll: []
}>()

const canDownload = computed(() => props.hasCurrentImage && !props.isExporting)
const canDownloadAll = computed(() => props.imageCount > 0 && !props.isExporting)

function handleFormatChange(e: Event): void {
  emit('update:format', (e.target as HTMLSelectElement).value as ExportFormat)
}

function handleQualityChange(e: Event): void {
  emit('update:quality', Number((e.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="export-panel">
    <div class="export-section">
      <div class="section-title">导出设置</div>

      <div class="form-row">
        <label class="form-label">格式</label>
        <select :value="format" class="form-select" @change="handleFormatChange">
          <option v-for="opt in FORMAT_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div v-if="format === 'jpeg'" class="form-row">
        <label class="form-label">JPG 质量</label>
        <div class="slider-group">
          <input type="range" min="0" max="100" :value="quality" @input="handleQualityChange" />
          <span class="slider-val">{{ quality }}%</span>
        </div>
      </div>
    </div>

    <div class="export-section">
      <div class="section-title">下载</div>

      <div class="export-buttons">
        <button
          class="primary-btn download-single"
          :disabled="!canDownload"
          @click="emit('download')"
        >
          💾 下载当前
        </button>
        <button
          class="primary-btn download-all"
          :disabled="!canDownloadAll"
          @click="emit('downloadAll')"
        >
          {{ isExporting ? '⏳ 处理中...' : `📦 下载全部 (${imageCount}张 · ZIP)` }}
        </button>
      </div>

      <div v-if="error" class="status-text error">{{ error }}</div>
      <div v-else-if="progress" class="status-text info">{{ progress }}</div>
    </div>

    <div class="export-tip">
      <p>📌 导出的 JPG 会保留原始 EXIF 信息（相机、时间、GPS 等）。</p>
      <p>📌 批量导出每张图应用各自的水印与调色设置。</p>
    </div>
  </div>
</template>

<style scoped>
.export-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 2px;
}

.export-section {
  background: #fff;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 14px 16px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 12px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.form-row:last-child {
  margin-bottom: 0;
}

.form-label {
  flex-shrink: 0;
  width: 70px;
  font-size: 13px;
  color: #666;
}

.form-select {
  flex: 1;
  max-width: 200px;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  background: #fff;
}

.slider-group {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.slider-group input[type='range'] {
  flex: 1;
  max-width: 240px;
}

.slider-val {
  min-width: 42px;
  text-align: right;
  color: #666;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.export-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.primary-btn {
  padding: 12px 16px;
  background: #34c759;
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.primary-btn:hover:not(:disabled) {
  background: #28a745;
}

.primary-btn:disabled {
  background: #c0c0c0;
  cursor: not-allowed;
}

.download-all {
  background: #007aff;
}

.download-all:hover:not(:disabled) {
  background: #0062cc;
}

.status-text {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.5;
}

.status-text.error {
  color: #ff3b30;
}

.status-text.info {
  color: #007aff;
}

.export-tip {
  font-size: 12px;
  color: #999;
  line-height: 1.6;
  padding: 0 4px;
}

.export-tip p {
  margin: 4px 0;
}
</style>
