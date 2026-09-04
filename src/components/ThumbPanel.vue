<script setup lang="ts">
import { computed } from 'vue'
import type { ImageItem } from '@/types'
import { MAX_IMAGES } from '@/constants'

const props = defineProps<{
  imageList: ImageItem[]
  currentIndex: number
}>()

const emit = defineEmits<{
  select: [index: number]
  remove: [index: number]
  add: []
}>()

const isMax = computed(() => props.imageList.length >= MAX_IMAGES)

function handleRemove(e: Event, index: number): void {
  e.stopPropagation()
  emit('remove', index)
}

function handleAdd(): void {
  if (isMax.value) {
    alert(`最多 ${MAX_IMAGES} 张图片`)
    return
  }
  emit('add')
}
</script>

<template>
  <div class="thumb-panel">
    <div v-if="imageList.length === 0" class="thumb-empty">
      <button class="add-btn empty-add" @click="handleAdd">＋ 添加图片</button>
    </div>
    <div v-else class="thumb-list">
      <div
        v-for="(item, index) in imageList"
        :key="item.id"
        class="thumb-item"
        :class="{ active: index === currentIndex }"
        @click="emit('select', index)"
      >
        <img :src="item.thumbDataURL" alt="" />
        <button class="thumb-remove" title="删除" @click="handleRemove($event, index)">×</button>
      </div>
      <button
        class="thumb-add-item"
        :class="{ disabled: isMax }"
        :title="isMax ? `最多 ${MAX_IMAGES} 张` : '添加图片'"
        @click="handleAdd"
      >
        <span class="thumb-add-icon">＋</span>
      </button>
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

.thumb-list {
  display: flex;
  flex-direction: row;
  align-items: center;
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

/* 末尾「+」添加卡片 */
.thumb-add-item {
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  border-radius: 6px;
  border: 2px dashed #ccc;
  background: #fff;
  color: #999;
  font-size: 24px;
  font-weight: 300;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.thumb-add-item:hover:not(.disabled) {
  border-color: #007aff;
  color: #007aff;
  background: #f0f7ff;
}

.thumb-add-item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.thumb-add-icon {
  line-height: 1;
  transform: translateY(-1px);
}

/* 空态添加按钮 */
.thumb-empty {
  text-align: center;
  padding: 10px 0;
}

.add-btn.empty-add {
  padding: 8px 20px;
  background: #007aff;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.add-btn.empty-add:hover {
  background: #0062cc;
}
</style>
