/**
 * HEIC/HEIF → JPEG 转换工具（一对一）
 * 依赖 heic-to（浏览器端 libheif 1.22.2 wasm），仅在真正需要转换时动态加载，
 * 不进入主 bundle，避免拖慢首屏。
 */

/** 判断文件是否为 HEIC/HEIF（按扩展名 + MIME 双重判断，兼容 file.type 为空的平台） */
export function isHeicFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    file.type === 'image/heic' ||
    file.type === 'image/heif'
  )
}

/**
 * 将单个 HEIC/HEIF 文件转换为高质量 JPEG（一对一，视觉无损）。
 *
 * 转换失败时抛出异常，由调用方决定如何提示；不做静默降级（返回原文件）。
 * 注意：heic-to 只转换像素数据，不保留原始 EXIF 元数据；libheif 输出 8-bit。
 *
 * quality 取 0.95：该 JPEG 是导出源（导出时直接解它当原图），必须视觉无损；
 * 相比 PNG（48MP 无损 ~120MB），quality 0.95 的 JPEG 约 15MB，常驻内存省 8 倍。
 */
export async function heicToJpg(file: File): Promise<File> {
  const { heicTo } = await import('heic-to')

  const blob = await heicTo({
    blob: file,
    type: 'image/jpeg',
    quality: 0.95,
  })

  const name = file.name.replace(/\.hei[cf]$/i, '.jpg')
  return new File([blob], name, {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  })
}
