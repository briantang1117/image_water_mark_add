<script setup lang="ts">
import type { ImageItem } from '@/types'

defineProps<{
  imageList: ImageItem[]
  currentIndex: number
}>()

const emit = defineEmits<{
  select: [index: number]
}>()
</script>

<template>
  <div class="thumb-panel">
    <h4>
      <span>图片列表</span>
      <span class="thumb-count">{{ imageList.length }}</span>
    </h4>
    <div class="thumb-list">
      <div v-if="imageList.length === 0" class="thumb-empty">暂无图片</div>
      <div
        v-for="(item, index) in imageList"
        :key="item.id"
        class="thumb-item"
        :class="{ active: index === currentIndex }"
        @click="emit('select', index)"
      >
        <img :src="item.thumbDataURL" alt="" />
        <div class="thumb-info">
          <div class="thumb-name" :title="item.name">{{ item.name }}</div>
          <div class="thumb-size">{{ item.img.width }} × {{ item.img.height }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thumb-panel {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 10px;
  background: #fafafa;
  max-height: 70vh;
  overflow-y: auto;
}

.thumb-panel h4 {
  margin: 0 0 10px 0;
  font-size: 13px;
  color: #555;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.thumb-count {
  background: #007aff;
  color: #fff;
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 12px;
}

.thumb-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.thumb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  border: 2px solid transparent;
  background: #fff;
  transition: background 0.15s;
}

.thumb-item:hover {
  background: #f0f7ff;
}

.thumb-item.active {
  border-color: #007aff;
  background: #eaf4ff;
}

.thumb-item img {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.thumb-item .thumb-info {
  flex: 1;
  min-width: 0;
}

.thumb-item .thumb-name {
  font-size: 12px;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.thumb-item .thumb-size {
  font-size: 11px;
  color: #999;
}

.thumb-empty {
  text-align: center;
  color: #bbb;
  font-size: 12px;
  padding: 20px 0;
}
</style>
