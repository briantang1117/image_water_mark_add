// 动态读取 src/assets 下所有 PNG 图片作为水印选项
// 新增水印只需将 PNG 放入 src/assets 目录，无需修改代码
const watermarkModules = import.meta.glob('@/assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export interface WatermarkOption {
  value: string
  label: string
  src: string
}

// 从文件名提取 value 和 label（去掉后缀）
function parseFileName(path: string): { value: string; label: string } {
  const fileName = path.split('/').pop() || path
  const name = fileName.replace(/\.[^.]+$/, '')
  return { value: name, label: name }
}

export const WATERMARK_OPTIONS: WatermarkOption[] = Object.entries(watermarkModules)
  .map(([path, src]) => ({
    ...parseFileName(path),
    src,
  }))
  .sort((a, b) => a.value.localeCompare(b.value))

// 水印 key -> src 的映射表
export const WATERMARK_SOURCES: Record<string, string> = WATERMARK_OPTIONS.reduce(
  (acc, opt) => {
    acc[opt.value] = opt.src
    return acc
  },
  {} as Record<string, string>,
)

// 默认水印 key（取第一个）
export const DEFAULT_WATERMARK_KEY = WATERMARK_OPTIONS[0]?.value ?? 'op4p_horizontal'

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
