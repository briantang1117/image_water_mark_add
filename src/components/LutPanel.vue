<script setup lang="ts">
// LUT 调色面板 — 占位，后续接入技术方案
defineProps<{
  hasCurrentImage: boolean
}>()
</script>

<template>
  <div class="lut-panel">
    <div class="lut-empty">
      <div class="lut-empty-icon">🎨</div>
      <div class="lut-empty-text">LUT 调色功能开发中...</div>
      <div class="lut-empty-hint">稍后将支持 3D LUT (Cube) 滤镜批量套用</div>
    </div>
  </div>
</template>

<style scoped>
.lut-panel {
  width: 100%;
  padding: 8px 0;
}

.lut-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 0;
  color: #999;
  gap: 8px;
}

.lut-empty-icon {
  font-size: 36px;
}

.lut-empty-text {
  font-size: 14px;
  font-weight: 500;
  color: #666;
}

.lut-empty-hint {
  font-size: 12px;
  color: #bbb;
}
</style>
