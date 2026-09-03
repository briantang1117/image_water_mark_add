export interface ExifInfo {
  make?: string
  model?: string
  lens?: string
  focalLength?: string
  aperture?: string
  shutterSpeed?: string
  iso?: string
  dateTime?: string
  gps?: string
  software?: string
}

export interface ImageItem {
  id: number
  name: string
  img: HTMLImageElement
  thumbDataURL: string
  width: number
  height: number
  exif?: ExifInfo
  /** 原始文件 ArrayBuffer（用于导出时写回 EXIF），仅 JPEG 有效 */
  originalBuffer?: ArrayBuffer
  /** 该图片使用的水印 key（空字符串表示无水印） */
  wmKey: string
  /** 该图片使用的 LUT id（空字符串表示无 LUT） */
  lutId: string
  /** 该图片的 LUT 浓度 0~100 */
  lutIntensity: number
  /** 该图片的 LUT 渲染模式 */
  lutMode: LutMode
}

export type BlendMode = 'screen' | 'lighten' | 'soft-light' | 'multiply' | 'source-over'

export type FitMode = 'contain' | 'cover' | 'original'

export type ExportFormat = 'jpeg' | 'png'

export interface RenderParams {
  wmKey: string
  blendMode: BlendMode
  fitMode: FitMode
  opacity: number
  scale: number
  posX: number
  posY: number
}

export interface WatermarkMap {
  [key: string]: HTMLImageElement
}

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

// ==================== LUT 相关类型 ====================

/** 解析后的 3D LUT 数据 */
export interface Lut3D {
  /** 唯一标识（通常用文件名） */
  id: string
  /** 显示名称 */
  label: string
  /** LUT 尺寸，如 17/33/65 */
  size: number
  /** TITLE 字段（如果有） */
  title?: string
  /** DOMAIN_MIN，默认 [0,0,0] */
  domainMin: [number, number, number]
  /** DOMAIN_MAX，默认 [1,1,1] */
  domainMax: [number, number, number]
  /**
   * LUT 数据，Float32Array，长度 = size^3 * 3
   * 索引顺序：R 变化最快（最内层），G 中间，B 最慢（最外层）
   * 即 data[(b * size * size + g * size + r) * 3 + channel]
   * channel: 0=R, 1=G, 2=B
   */
  data: Float32Array
}

/**
 * LUT 渲染模式
 * - professional：Rec.709 还原模式（默认）——把 sRGB 图重编码为 Rec.709 显示信号(BT.1886 γ≈2.4)后查表
 * - ps：sRGB 直查（对照 Photoshop「颜色查找」）
 */
export type LutMode = 'ps' | 'professional'

/** LUT 面板参数 */
export interface LutParams {
  /** 当前选中的 LUT id，空表示无 LUT */
  lutId: string
  /** 浓度 0~100 */
  intensity: number
  /** 渲染模式：Rec.709 还原(默认) / sRGB 直查 */
  mode: LutMode
}
