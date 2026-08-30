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
