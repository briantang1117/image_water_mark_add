<script setup lang="ts">
import type { ImageItem } from '@/types'

defineProps<{
  imageList: ImageItem[]
  currentIndex: number
}>()

const emit = defineEmits<{
  select: [index: number]
  remove: [index: number]
}>()

function handleRemove(e: Event, index: number): void {
  e.stopPropagation()
  emit('remove', index)
}
</script>

<template>
  <div class="thumb-panel">
    <div class="thumb-header">
      <span class="thumb-title">图片列表</span>
      <span class="thumb-count">{{ imageList.length }}</span>
    </div>
    <div v-if="imageList.length === 0" class="thumb-empty">暂无图片</div>
    <div v-else class="thumb-list">
      <div
        v-for="(item, index) in imageList"
        :key="item.id"
        class="thumb-item"
        :class="{ active: index === currentIndex }"
        @click="emit('select', index)"
      >
        <img :src="item.thumbDataURL" alt="" />
        <button class="thumb-remove" @click="handleRemove($event, index)" title="删除">
          ×
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thumb-panel {
  width: 100%;
  flex-shrink: 0;
  background: #f8f8f8;
  border-radius: 8px;
  padding: 6px 10px;
}

.thumb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.thumb-title {
  font-size: 12px;
  color: #666;
  font-weight: 500;
}

.thumb-count {
  background: #007aff;
  color: #fff;
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 11px;
}

.thumb-list {
  display: flex;
  flex-direction: row;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
  -webkit-overflow-scrolling: touch;
}

.thumb-list::-webkit-scrollbar {
  height: 4px;
}

.thumb-list::-webkit-scrollbar-track {
  background: transparent;
}

.thumb-list::-webkit-scrollbar-thumb {
  background: #ccc;
  border-radius: 2px;
}

.thumb-item {
  position: relative;
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  background: #fff;
  transition: border-color 0.15s;
}

.thumb-item.active {
  border-color: #007aff;
}

.thumb-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-remove {
  position: absolute;
  top: 0;
  right: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 0 0 0 4px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 14px;
  line-height: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}

.thumb-item:hover .thumb-remove,
.thumb-item.active .thumb-remove {
  opacity: 1;
}

.thumb-remove:hover {
  background: #ff3b30;
}

.thumb-empty {
  text-align: center;
  color: #bbb;
  font-size: 12px;
  padding: 16px 0;
}
</style>
