import type { Lut3D } from '@/types'

/**
 * 解析标准 .cube 3D-LUT 文件
 * 支持：TITLE、LUT_3D_SIZE、DOMAIN_MIN、DOMAIN_MAX、逐行 RGB 数据
 * 数据顺序：按 B 递增（最外层） → G 递增 → R 递增（最内层）
 *
 * @param text .cube 文件文本内容
 * @param id   唯一标识（通常用文件名）
 * @param label 显示名称
 */
export function parseCubeFile(text: string, id: string, label: string): Lut3D {
  // 去掉 Windows 换行、BOM（U+FEFF）
  const cleanText = text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
  const lines = cleanText.split('\n')

  let size = 0
  let title: string | undefined
  let domainMin: [number, number, number] = [0, 0, 0]
  let domainMax: [number, number, number] = [1, 1, 1]
  const tableData: number[] = []

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()

    // 跳过空行和注释
    if (!line || line.startsWith('#')) continue

    // 去掉行尾注释
    const hashIdx = line.indexOf(' #')
    if (hashIdx > 0) line = line.slice(0, hashIdx).trim()

    // TITLE
    if (line.toUpperCase().startsWith('TITLE')) {
      const match = line.match(/TITLE\s+"([^"]*)"/i)
      if (match) title = match[1]
      continue
    }

    // LUT_3D_SIZE
    if (line.toUpperCase().startsWith('LUT_3D_SIZE')) {
      const parts = line.split(/\s+/)
      if (parts.length >= 2) {
        size = parseInt(parts[1], 10)
      }
      continue
    }

    // DOMAIN_MIN
    if (line.toUpperCase().startsWith('DOMAIN_MIN')) {
      const parts = line.split(/\s+/)
      if (parts.length >= 4) {
        domainMin = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]
      }
      continue
    }

    // DOMAIN_MAX
    if (line.toUpperCase().startsWith('DOMAIN_MAX')) {
      const parts = line.split(/\s+/)
      if (parts.length >= 4) {
        domainMax = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]
      }
      continue
    }

    // 跳过其他以字母开头的关键字（扩展字段）
    if (/^[A-Za-z]/.test(line)) {
      continue
    }

    // 数据行：三个浮点数 R G B
    const values = line.split(/[\s,]+/).filter(Boolean)
    if (values.length >= 3) {
      const r = parseFloat(values[0])
      const g = parseFloat(values[1])
      const b = parseFloat(values[2])
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        tableData.push(r, g, b)
      }
    }
  }

  // 校验
  if (!size || size < 2) {
    throw new Error('无效的 LUT 文件：缺少 LUT_3D_SIZE 或尺寸异常')
  }

  const expectedCount = size * size * size
  if (tableData.length / 3 !== expectedCount) {
    throw new Error(
      `LUT 数据点数不匹配：期望 ${expectedCount} 个点，实际 ${Math.floor(tableData.length / 3)} 个`,
    )
  }

  return {
    id,
    label,
    size,
    title,
    domainMin,
    domainMax,
    data: new Float32Array(tableData),
  }
}

/**
 * 从 File 对象解析 .cube 文件
 */
export async function parseCubeFileFromFile(file: File): Promise<Lut3D> {
  const text = await file.text()
  const baseName = file.name.replace(/\.cube$/i, '')
  return parseCubeFile(text, file.name, baseName)
}
