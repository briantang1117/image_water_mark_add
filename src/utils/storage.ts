import { BRANDS, WATERMARK_SOURCES } from '@/constants'

const STORAGE_KEY_BRAND = 'dji-water:last-brand'
const STORAGE_KEY_WMKEY = 'dji-water:last-wmkey'

/** 从 wmKey 中解析品牌 key */
function extractBrandKey(wmKey: string): string {
  return wmKey.split('/')[0] ?? ''
}

/** 校验品牌 key 是否有效 */
function isValidBrand(brandKey: string): boolean {
  return BRANDS.some((b) => b.key === brandKey)
}

/** 校验 wmKey 是否有效 */
function isValidWmKey(wmKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(WATERMARK_SOURCES, wmKey)
}

/** 保存上次选择的品牌和水印 */
export function saveLastSelection(wmKey: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const brandKey = extractBrandKey(wmKey)
    localStorage.setItem(STORAGE_KEY_BRAND, brandKey)
    localStorage.setItem(STORAGE_KEY_WMKEY, wmKey)
  } catch (e) {
    // localStorage 不可用（隐私模式等）时静默失败
    console.warn('无法写入 localStorage:', e)
  }
}

export interface LastSelection {
  brandKey?: string
  wmKey?: string
}

/** 读取上次选择的品牌和水印（带有效性校验） */
export function loadLastSelection(): LastSelection {
  const result: LastSelection = {}
  if (typeof window === 'undefined' || !window.localStorage) return result

  try {
    const wmKey = localStorage.getItem(STORAGE_KEY_WMKEY)
    if (wmKey && isValidWmKey(wmKey)) {
      result.wmKey = wmKey
      const brandKey = extractBrandKey(wmKey)
      if (isValidBrand(brandKey)) {
        result.brandKey = brandKey
      }
      return result
    }

    // 如果 wmKey 无效，单独尝试品牌
    const brandKey = localStorage.getItem(STORAGE_KEY_BRAND)
    if (brandKey && isValidBrand(brandKey)) {
      result.brandKey = brandKey
    }
  } catch (e) {
    console.warn('无法读取 localStorage:', e)
  }

  return result
}
