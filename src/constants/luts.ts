import type { Lut3D } from '@/types'
import { parseCubeFile } from '@/utils/cubeParser'

// 动态读取 src/assets/luts/<category>/*.cube 下所有 LUT 文件
// 新增分类/LUT 只需在 luts 下新建分类文件夹并放入 .cube 文件，无需修改代码
const lutModules = import.meta.glob('@/assets/luts/*/*.cube', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

export interface LutOption {
  value: string
  label: string
  size: number
}

export interface LutCategory {
  key: string
  label: string
  luts: LutOption[]
}

// 已解析的 LUT 数据缓存（懒加载，首次访问时解析）
const lutCache = new Map<string, Lut3D>()

// 从路径中解析分类和文件名
// 路径格式：/src/assets/luts/<category>/<name>.cube
function parsePath(path: string): { categoryKey: string; fileName: string; label: string } {
  const parts = path.split('/')
  const fileName = (parts.pop() || path).replace(/\.cube$/i, '')
  const categoryKey = parts.pop() || 'unknown'
  return { categoryKey, fileName, label: fileName }
}

// 构建分类列表
function buildCategories(): { categories: LutCategory[]; allLuts: Map<string, string> } {
  const categoryMap = new Map<string, LutCategory>()
  const allLuts = new Map<string, string>() // value -> path

  Object.entries(lutModules).forEach(([path]) => {
    const { categoryKey, fileName, label } = parsePath(path)
    const lutValue = `${categoryKey}/${fileName}`

    allLuts.set(lutValue, path)

    if (!categoryMap.has(categoryKey)) {
      categoryMap.set(categoryKey, {
        key: categoryKey,
        label: categoryKey,
        luts: [],
      })
    }

    // size 先填 0，后面懒解析时再填
    categoryMap.get(categoryKey)!.luts.push({
      value: lutValue,
      label,
      size: 0,
    })
  })

  // 分类按名称排序，每个分类下的 LUT 也按名称排序
  const categories = Array.from(categoryMap.values())
    .sort((a, b) => a.key.localeCompare(b.key, 'zh-CN'))
    .map((cat) => ({
      ...cat,
      luts: cat.luts.sort((a, b) => a.value.localeCompare(b.value, 'zh-CN')),
    }))

  return { categories, allLuts }
}

const { categories: LUT_CATEGORIES, allLuts: lutPathMap } = buildCategories()

export { LUT_CATEGORIES }

// 默认分类 key（取第一个分类）
export const DEFAULT_LUT_CATEGORY = LUT_CATEGORIES[0]?.key ?? ''

/**
 * 根据 LUT value 获取解析后的 Lut3D 对象（懒加载，带缓存）
 */
export function getLutData(value: string): Lut3D | null {
  if (!value) return null

  if (lutCache.has(value)) {
    return lutCache.get(value)!
  }

  const path = lutPathMap.get(value)
  if (!path) return null

  const rawText = lutModules[path]
  if (!rawText) return null

  try {
    const { categoryKey, label } = parsePath(path)
    const lut = parseCubeFile(rawText, value, label)
    lutCache.set(value, lut)
    // 更新 size 信息
    const cat = LUT_CATEGORIES.find((c) => c.key === categoryKey)
    const opt = cat?.luts.find((l) => l.value === value)
    if (opt) opt.size = lut.size
    return lut
  } catch (e) {
    console.error(`解析 LUT 失败: ${value}`, e)
    return null
  }
}

/**
 * 预加载某个分类下的所有 LUT（可选优化，进入分类时调用）
 */
export function preloadCategory(categoryKey: string): void {
  const cat = LUT_CATEGORIES.find((c) => c.key === categoryKey)
  if (!cat) return
  cat.luts.forEach((lut) => {
    // 触发懒加载
    getLutData(lut.value)
  })
}
