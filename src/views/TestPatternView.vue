<script setup lang="ts">
import { ref, onMounted } from 'vue'

const canvasRef = ref<HTMLCanvasElement | null>(null)

function drawPattern(): void {
  const canvas = canvasRef.value
  if (!canvas) return

  const W = 3840
  const H = 2160
  canvas.width = W
  canvas.height = H

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 背景黑
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  // ========== 上半部分：灰阶测试 ==========
  const halfH = H / 2

  // 1. 连续线性灰阶渐变（上半部分上 1/3）
  const gradH = halfH * 0.4
  const grad = ctx.createLinearGradient(0, 0, W, 0)
  for (let i = 0; i <= 255; i++) {
    grad.addColorStop(i / 255, `rgb(${i},${i},${i})`)
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, gradH)

  // 2. 21 级标准灰阶条（0, 12.75, 25.5 ... 255）
  const stepCount = 21
  const stepW = W / stepCount
  const stepH = halfH * 0.3
  for (let i = 0; i < stepCount; i++) {
    const v = Math.round((i / (stepCount - 1)) * 255)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(i * stepW, gradH, stepW, stepH)
  }

  // 3. 暗部精细灰阶（0~32，64级）—— 用来测暗部差异
  const darkH = halfH * 0.15
  const darkSteps = 64
  const darkStepW = W / darkSteps
  for (let i = 0; i < darkSteps; i++) {
    const v = Math.round((i / (darkSteps - 1)) * 32)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(i * darkStepW, gradH + stepH, darkStepW, darkH)
  }

  // 4. 亮部精细灰阶（223~255，32级）—— 用来测亮部差异
  const lightH = halfH * 0.15
  const lightSteps = 32
  const lightStepW = W / lightSteps
  for (let i = 0; i < lightSteps; i++) {
    const v = Math.round(223 + (i / (lightSteps - 1)) * 32)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(i * lightStepW, gradH + stepH + darkH, lightStepW, lightH)
  }

  // ========== 下半部分：彩色测试 ==========
  const yStart = halfH

  // 1. 六原色渐变条（R→G→B→R 循环）
  const rainbowH = halfH * 0.3
  const rainbowGrad = ctx.createLinearGradient(0, 0, W, 0)
  const stops = [
    { pos: 0, r: 255, g: 0, b: 0 }, // 红
    { pos: 1 / 6, r: 255, g: 255, b: 0 }, // 黄
    { pos: 2 / 6, r: 0, g: 255, b: 0 }, // 绿
    { pos: 3 / 6, r: 0, g: 255, b: 255 }, // 青
    { pos: 4 / 6, r: 0, g: 0, b: 255 }, // 蓝
    { pos: 5 / 6, r: 255, g: 0, b: 255 }, // 品红
    { pos: 1, r: 255, g: 0, b: 0 }, // 红
  ]
  for (const s of stops) {
    rainbowGrad.addColorStop(s.pos, `rgb(${s.r},${s.g},${s.b})`)
  }
  ctx.fillStyle = rainbowGrad
  ctx.fillRect(0, yStart, W, rainbowH)

  // 2. R 通道渐变（从黑到纯红，全饱和）
  const singleH = halfH * 0.15
  const channelY = yStart + rainbowH
  const channelW = W / 3

  // 红渐变
  const rGrad = ctx.createLinearGradient(0, 0, channelW, 0)
  for (let i = 0; i <= 255; i++) {
    rGrad.addColorStop(i / 255, `rgb(${i},0,0)`)
  }
  ctx.fillStyle = rGrad
  ctx.fillRect(0, channelY, channelW, singleH)

  // 绿渐变
  const gGrad = ctx.createLinearGradient(0, 0, channelW, 0)
  for (let i = 0; i <= 255; i++) {
    gGrad.addColorStop(i / 255, `rgb(0,${i},0)`)
  }
  ctx.fillStyle = gGrad
  ctx.fillRect(channelW, channelY, channelW, singleH)

  // 蓝渐变
  const bGrad = ctx.createLinearGradient(0, 0, channelW, 0)
  for (let i = 0; i <= 255; i++) {
    bGrad.addColorStop(i / 255, `rgb(0,0,${i})`)
  }
  ctx.fillStyle = bGrad
  ctx.fillRect(channelW * 2, channelY, channelW, singleH)

  // 3. 饱和度渐变（固定色相，饱和度从0到100%）
  const satH = halfH * 0.25
  const satY = channelY + singleH
  const hueCount = 6
  const hueW = W / hueCount
  const hues = [0, 60, 120, 180, 240, 300] // 红黄绿青蓝品红

  for (let h = 0; h < hueCount; h++) {
    const hue = hues[h]
    const grad = ctx.createLinearGradient(0, 0, hueW, 0)
    for (let s = 0; s <= 100; s++) {
      grad.addColorStop(s / 100, `hsl(${hue}, ${s}%, 50%)`)
    }
    ctx.fillStyle = grad
    ctx.fillRect(h * hueW, satY, hueW, satH)
  }

  // 4. 底部色卡（24 色标准色卡，简化版）
  const cardH = halfH * 0.15
  const cardY = satY + satH
  const colors = [
    // 高饱和
    '#ff0000',
    '#00ff00',
    '#0000ff',
    '#ffff00',
    '#00ffff',
    '#ff00ff',
    // 中饱和
    '#cc3333',
    '#33cc33',
    '#3333cc',
    '#cccc33',
    '#33cccc',
    '#cc33cc',
    // 低饱和/肤色
    '#c89678',
    '#826a5a',
    '#c88484',
    '#6a8282',
    '#82a282',
    '#a282a2',
    // 灰阶
    '#ffffff',
    '#cccccc',
    '#999999',
    '#666666',
    '#333333',
    '#000000',
  ]
  const colorW = W / colors.length
  for (let i = 0; i < colors.length; i++) {
    ctx.fillStyle = colors[i]
    ctx.fillRect(i * colorW, cardY, colorW, cardH)
  }

  // 标签
  ctx.fillStyle = '#fff'
  ctx.font = '24px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('灰阶渐变 (0-255)', 20, 30)
  ctx.fillText('21级灰阶', 20, gradH + 30)
  ctx.fillText('暗部精细 (0-32)', 20, gradH + stepH + 20)
  ctx.fillText('亮部精细 (223-255)', 20, gradH + stepH + darkH + 20)
  ctx.fillText('色相渐变', 20, yStart + 30)
  ctx.fillText('R / G / B 单通道渐变', 20, channelY + 25)
  ctx.fillText('饱和度渐变 (6色相)', 20, satY + 25)
  ctx.fillText('24色卡', 20, cardY + 25)
}

function download(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'test_pattern_3840x2160.png'
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}

onMounted(drawPattern)
</script>

<template>
  <div class="container">
    <div class="header">
      <h2>🎨 色彩测试图生成器</h2>
      <button class="download-btn" @click="download">💾 下载 PNG (3840×2160)</button>
    </div>
    <div class="canvas-wrap">
      <canvas ref="canvasRef" class="pattern-canvas" />
    </div>
    <p class="hint">
      测试图包含：灰阶渐变 / 21级灰阶 / 暗部精细灰阶 / 亮部精细灰阶 / 色相渐变 / RGB单通道渐变 /
      饱和度渐变 / 24色卡 — 用于精准定位 LUT 色差来源。
    </p>
  </div>
</template>

<style scoped>
.container {
  padding: 16px;
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.header {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

h2 {
  margin: 0;
  font-size: 18px;
}

.download-btn {
  padding: 8px 16px;
  background: #34c759;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.download-btn:hover {
  background: #28a745;
}

.canvas-wrap {
  flex: 1;
  min-height: 0;
  background: #1a1a1a;
  border-radius: 8px;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.pattern-canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.hint {
  font-size: 12px;
  color: #888;
  margin: 0;
  flex-shrink: 0;
}
</style>
