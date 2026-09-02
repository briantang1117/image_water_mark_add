// 动态读取 src/assets/<brand>/*.png 下所有 PNG 图片作为水印选项
// 新增品牌/水印只需在 src/assets 下新建品牌文件夹并放入 PNG，无需修改代码
const watermarkModules = import.meta.glob('@/assets/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export interface WatermarkOption {
  value: string
  label: string
  src: string
}

export interface Brand {
  key: string
  label: string
  watermarks: WatermarkOption[]
}

// 从路径中解析品牌和文件名
// 路径格式：/src/assets/<brand>/<name>.png
function parsePath(path: string): { brandKey: string; fileName: string; label: string } {
  const parts = path.split('/')
  const fileName = (parts.pop() || path).replace(/\.[^.]+$/, '')
  const brandKey = parts.pop() || 'unknown'
  return { brandKey, fileName, label: fileName }
}

// 品牌显示名（首字母大写，其余保持原样）
function formatBrandLabel(key: string): string {
  if (!key) return key
  return key.charAt(0).toUpperCase() + key.slice(1)
}

// 构建品牌列表
const brandMap = new Map<string, Brand>()

Object.entries(watermarkModules).forEach(([path, src]) => {
  const { brandKey, fileName, label } = parsePath(path)
  const wmValue = `${brandKey}/${fileName}`

  if (!brandMap.has(brandKey)) {
    brandMap.set(brandKey, {
      key: brandKey,
      label: formatBrandLabel(brandKey),
      watermarks: [],
    })
  }

  brandMap.get(brandKey)!.watermarks.push({
    value: wmValue,
    label,
    src,
  })
})

// 品牌按名称排序，每个品牌下的水印也按名称排序
export const BRANDS: Brand[] = Array.from(brandMap.values())
  .sort((a, b) => a.key.localeCompare(b.key))
  .map((brand) => ({
    ...brand,
    watermarks: brand.watermarks.sort((a, b) => a.value.localeCompare(b.value)),
  }))

// 打平的水印列表（兼容旧代码）
export const WATERMARK_OPTIONS: WatermarkOption[] = BRANDS.flatMap((brand) => brand.watermarks)

// 水印 key -> src 的映射表
export const WATERMARK_SOURCES: Record<string, string> = WATERMARK_OPTIONS.reduce(
  (acc, opt) => {
    acc[opt.value] = opt.src
    return acc
  },
  {} as Record<string, string>,
)

// 默认品牌 key（取第一个品牌）
export const DEFAULT_BRAND_KEY = BRANDS[0]?.key ?? 'dji'
// 默认水印 key：空字符串表示无水印
export const DEFAULT_WATERMARK_KEY = ''

export const BLEND_MODE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'screen', label: 'Screen 滤色（黑底水印推荐）' },
  { value: 'lighten', label: 'Lighten 增亮' },
  { value: 'soft-light', label: 'Soft-Light 柔光' },
  { value: 'multiply', label: 'Multiply 正片叠底' },
  { value: 'source-over', label: '正常叠加' },
]

export const FIT_MODE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contain', label: 'Contain 完整显示（推荐）' },
  { value: 'cover', label: 'Cover 铺满裁切' },
  { value: 'original', label: 'Original 原始尺寸' },
]

export const FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'jpeg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
]

export const DEFAULT_PARAMS = {
  wmKey: DEFAULT_WATERMARK_KEY,
  blendMode: 'screen' as string,
  fitMode: 'contain' as string,
  opacity: 100,
  scale: 100,
  posX: 50,
  posY: 100,
  format: 'jpeg' as string,
  quality: 95,
}
