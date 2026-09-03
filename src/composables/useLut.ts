import { ref, computed, watch } from 'vue'
import { useWatermark } from './useWatermark'
import type { LutMode } from '@/types'
import { LUT_CATEGORIES, DEFAULT_LUT_CATEGORY, getLutData, preloadCategory } from '@/constants/luts'

// ==================== 全局单例状态 ====================

const currentCategory = ref<string>(DEFAULT_LUT_CATEGORY)
let inited = false

// ==================== composable ====================

export function useLut() {
  const { currentImage } = useWatermark()

  // 只初始化一次
  if (!inited) {
    inited = true
    // 当切换图片时，根据新图片的 lutId 同步分类
    watch(
      () => currentImage.value?.lutId,
      (lutId) => {
        if (lutId) {
          const catKey = lutId.split('/')[0]
          const cat = LUT_CATEGORIES.find((c) => c.key === catKey)
          if (cat) {
            currentCategory.value = catKey
          }
        }
        // lutId 为空时不自动切分类，保持用户当前浏览的分类
      },
    )
  }

  // 当前分类下的 LUT 列表
  const currentCategoryLuts = computed(() => {
    const cat = LUT_CATEGORIES.find((c) => c.key === currentCategory.value)
    return cat?.luts ?? []
  })

  // ==================== 当前 LUT ====================

  const currentLutId = computed({
    get(): string {
      return currentImage.value?.lutId ?? ''
    },
    set(id: string) {
      const img = currentImage.value
      if (img) img.lutId = id
      // 如果切换到了有分类的 LUT，同步分类
      if (id) {
        const catKey = id.split('/')[0]
        const cat = LUT_CATEGORIES.find((c) => c.key === catKey)
        if (cat) {
          currentCategory.value = catKey
        }
      }
    },
  })

  // ==================== 浓度 ====================

  const intensity = computed({
    get(): number {
      return currentImage.value?.lutIntensity ?? 100
    },
    set(val: number) {
      const img = currentImage.value
      if (img) img.lutIntensity = Math.max(0, Math.min(100, val))
    },
  })

  // ==================== 模式 ====================

  const mode = computed({
    get(): LutMode {
      return currentImage.value?.lutMode ?? 'professional'
    },
    set(val: LutMode) {
      const img = currentImage.value
      if (img) img.lutMode = val
    },
  })

  // 兼容旧接口：params 对象
  const params = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'lutId') return currentLutId.value
        if (prop === 'intensity') return intensity.value
        if (prop === 'mode') return mode.value
        return undefined
      },
      set(_target, prop: string, value: unknown) {
        if (prop === 'lutId') {
          currentLutId.value = value as string
        } else if (prop === 'intensity') {
          intensity.value = value as number
        } else if (prop === 'mode') {
          mode.value = value as LutMode
        }
        return true
      },
    },
  ) as { lutId: string; intensity: number; mode: LutMode }

  // ==================== 方法 ====================

  function selectCategory(key: string): void {
    currentCategory.value = key
    // 预加载分类
    requestAnimationFrame(() => preloadCategory(key))
    // 如果有当前图片，自动选中该分类第一个 LUT
    const img = currentImage.value
    if (img) {
      const cat = LUT_CATEGORIES.find((c) => c.key === key)
      if (cat && cat.luts.length > 0) {
        img.lutId = cat.luts[0].value
      }
    }
  }

  function selectLut(id: string): void {
    currentLutId.value = id
  }

  function setIntensity(val: number): void {
    intensity.value = val
  }

  function setMode(val: LutMode): void {
    mode.value = val
  }

  function resetParams(): void {
    intensity.value = 100
    mode.value = 'professional'
  }

  /** 获取当前选中 LUT 的数据（懒解析） */
  function getCurrentLut() {
    const id = currentLutId.value
    if (!id) return null
    return getLutData(id)
  }

  return {
    LUT_CATEGORIES,
    currentCategory,
    currentCategoryLuts,
    currentLutId,
    params,
    intensity,
    mode,
    selectCategory,
    selectLut,
    getCurrentLut,
    setIntensity,
    setMode,
    resetParams,
  }
}
