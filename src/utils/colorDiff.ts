/**
 * 颜色空间转换 + CIEDE2000 色差计算
 *
 * 转换链：sRGB → 线性 RGB → XYZ → Lab
 */

// sRGB → 线性 RGB
function srgbToLinear(c: number): number {
  c = c / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

// 线性 sRGB → XYZ (D65 白点)
function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  // 用 D65 参考白点的 sRGB → XYZ 矩阵
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  return [x, y, z]
}

// XYZ → Lab
const XN = 0.95047 // D65 X
const YN = 1.0 // D65 Y
const ZN = 1.08883 // D65 Z

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const xr = x / XN
  const yr = y / YN
  const zr = z / ZN

  const e = 216 / 24389 // 0.008856...
  const k = 24389 / 27 // 903.3

  const fx = xr > e ? Math.cbrt(xr) : (k * xr + 16) / 116
  const fy = yr > e ? Math.cbrt(yr) : (k * yr + 16) / 116
  const fz = zr > e ? Math.cbrt(zr) : (k * zr + 16) / 116

  const L = 116 * fy - 16
  const a = 500 * (fx - fy)
  const b = 200 * (fy - fz)

  return [L, a, b]
}

/** sRGB (0-255) → Lab */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const [x, y, z] = rgbToXyz(lr, lg, lb)
  return xyzToLab(x, y, z)
}

/**
 * CIEDE2000 色差
 * 返回 ΔE'_00 值
 * 参考: http://www.ece.rochester.edu/~gsharma/ciede2000/
 */
export function ciede2000(
  lab1: [number, number, number],
  lab2: [number, number, number],
  kL = 1,
  kC = 1,
  kH = 1,
): number {
  const [L1, a1, b1] = lab1
  const [L2, a2, b2] = lab2

  // Step 1: 计算 C'1, C'2, h'1, h'2
  const C1 = Math.sqrt(a1 * a1 + b1 * b1)
  const C2 = Math.sqrt(a2 * a2 + b2 * b2)
  const Cbar = (C1 + C2) / 2
  const Cbar7 = Math.pow(Cbar, 7)
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))))

  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.sqrt(a1p * a1p + b1 * b1)
  const C2p = Math.sqrt(a2p * a2p + b2 * b2)

  const h1p = (b1 === 0 && a1p === 0) ? 0 : Math.atan2(b1, a1p)
  const h2p = (b2 === 0 && a2p === 0) ? 0 : Math.atan2(b2, a2p)

  // Step 2: ΔL', ΔC', ΔH'
  const dLp = L2 - L1
  const dCp = C2p - C1p

  const productCp = C1p * C2p

  const dhp: number = (() => {
    if (productCp === 0) return 0
    let diff = h2p - h1p
    if (diff > Math.PI) diff -= 2 * Math.PI
    else if (diff < -Math.PI) diff += 2 * Math.PI
    return diff
  })()

  const dHp = 2 * Math.sqrt(productCp) * Math.sin(dhp / 2)

  // Step 3: CIEDE2000
  const Lbarp = (L1 + L2) / 2
  const Cbarp = (C1p + C2p) / 2

  const hbarp: number = (() => {
    if (productCp === 0) return h1p + h2p
    const sum = h1p + h2p
    const diff = h1p - h2p
    if (Math.abs(diff) > Math.PI) {
      if (sum < 2 * Math.PI) return (sum + 2 * Math.PI) / 2
      else return (sum - 2 * Math.PI) / 2
    }
    return sum / 2
  })()

  const T =
    1 -
    0.17 * Math.cos(hbarp - Math.PI / 6) +
    0.24 * Math.cos(2 * hbarp) +
    0.32 * Math.cos(3 * hbarp + Math.PI / 30) -
    0.2 * Math.cos(4 * hbarp - (63 * Math.PI) / 180)

  const dTheta = (30 * Math.PI / 180) * Math.exp(-Math.pow(((hbarp - (275 * Math.PI) / 180) / (25 * Math.PI / 180)), 2))

  const Cbarp7 = Math.pow(Cbarp, 7)
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)))

  const Lbarp2 = (Lbarp - 50) * (Lbarp - 50)
  const SL = 1 + (0.015 * Lbarp2) / Math.sqrt(20 + Lbarp2)
  const SC = 1 + 0.045 * Cbarp
  const SH = 1 + 0.015 * Cbarp * T
  const RT = -Math.sin(2 * dTheta) * RC

  const dE = Math.sqrt(
    Math.pow(dLp / (kL * SL), 2) +
      Math.pow(dCp / (kC * SC), 2) +
      Math.pow(dHp / (kH * SH), 2) +
      RT * (dCp / (kC * SC)) * (dHp / (kH * SH)),
  )

  return dE
}

/**
 * 伪彩色映射：将标量值 (0~max) 映射为 RGB 颜色
 * 使用经典的 jet 配色（蓝→青→绿→黄→红）
 */
export function heatColor(value: number, maxVal: number): [number, number, number] {
  if (maxVal <= 0) return [0, 0, 0]
  const t = Math.max(0, Math.min(1, value / maxVal))

  // jet colormap: 0.0=蓝, 0.25=青, 0.5=绿, 0.75=黄, 1.0=红
  let r: number, g: number, b: number
  if (t < 0.25) {
    r = 0
    g = t / 0.25
    b = 1
  } else if (t < 0.5) {
    r = 0
    g = 1
    b = 1 - (t - 0.25) / 0.25
  } else if (t < 0.75) {
    r = (t - 0.5) / 0.25
    g = 1
    b = 0
  } else {
    r = 1
    g = 1 - (t - 0.75) / 0.25
    b = 0
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}
