export interface ImageItem {
  id: number
  name: string
  img: HTMLImageElement
  thumbDataURL: string
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
