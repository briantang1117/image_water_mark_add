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
  // 去掉 Windows 换行、BOM
  const cleanText = text.replace(/\r\n/g, '\n').replace(/^﻿/, '')
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

/**
 * 生成一个中性 LUT（输入 = 输出），用于默认占位 / 测试
 * size 默认 33
 */
export function createNeutralLut(size = 33, id = 'neutral', label = '中性（无效果）'): Lut3D {
  const total = size * size * size
  const data = new Float32Array(total * 3)
  const max = size - 1

  let idx = 0
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[idx++] = r / max
        data[idx++] = g / max
        data[idx++] = b / max
      }
    }
  }

  return {
    id,
    label,
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data,
  }
}

type ColorTransform = (r: number, g: number, b: number) => [number, number, number]

/**
 * 基于变换函数生成 LUT
 */
function generateLut(
  size: number,
  id: string,
  label: string,
  transform: ColorTransform,
): Lut3D {
  const total = size * size * size
  const data = new Float32Array(total * 3)
  const max = size - 1

  let idx = 0
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const ri = r / max
        const gi = g / max
        const bi = b / max
        const [ro, go, bo] = transform(ri, gi, bi)
        data[idx++] = Math.max(0, Math.min(1, ro))
        data[idx++] = Math.max(0, Math.min(1, go))
        data[idx++] = Math.max(0, Math.min(1, bo))
      }
    }
  }

  return {
    id,
    label,
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data,
  }
}

/**
 * 暖色调 LUT — 提升红、轻微降蓝，模拟夕阳暖色
 */
export function createWarmLut(size = 33): Lut3D {
  return generateLut(size, 'builtin-warm', '暖阳', (r, g, b) => {
    // S 型曲线 + 色彩偏移：中间调影响最大
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    const midFactor = 4 * luminance * (1 - luminance) // 中间调最高
    return [
      r + 0.08 * midFactor,
      g + 0.02 * midFactor,
      b - 0.06 * midFactor,
    ]
  })
}

/**
 * 冷色调 LUT — 提升蓝、轻微降红，模拟清冷蓝调
 */
export function createCoolLut(size = 33): Lut3D {
  return generateLut(size, 'builtin-cool', '清蓝', (r, g, b) => {
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    const midFactor = 4 * luminance * (1 - luminance)
    return [
      r - 0.04 * midFactor,
      g + 0.02 * midFactor,
      b + 0.08 * midFactor,
    ]
  })
}

/**
 * 高对比度 LUT — S 曲线增强对比
 */
export function createHighContrastLut(size = 33): Lut3D {
  return generateLut(size, 'builtin-contrast', '高对比', (r, g, b) => {
    // S 曲线：contrast 控制强度
    const contrast = 0.25
    const sCurve = (v: number) => {
      if (v < 0.5) {
        return 0.5 * Math.pow(v * 2, 1 + contrast)
      }
      return 1 - 0.5 * Math.pow((1 - v) * 2, 1 + contrast)
    }
    return [sCurve(r), sCurve(g), sCurve(b)]
  })
}

/**
 * 褪色胶片 LUT — 低对比 + 轻微偏色，模拟复古胶片
 */
export function createFilmLut(size = 33): Lut3D {
  return generateLut(size, 'builtin-film', '胶片', (r, g, b) => {
    // 提升黑位，降低高光 → 灰雾感
    const lift = 0.06
    const gain = 0.92
    const ro = r * gain + lift
    const go = g * gain + lift
    const bo = b * gain + lift * 0.8
    // 轻微偏青
    return [ro * 0.97, go, bo * 1.03]
  })
}

/**
 * 获取所有内置 LUT
 */
export function getBuiltinLuts(size = 33): Lut3D[] {
  return [createWarmLut(size), createCoolLut(size), createHighContrastLut(size), createFilmLut(size)]
}
