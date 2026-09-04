<script setup lang="ts">
import { ref, computed } from 'vue'
import { ciede2000, srgbToLab, heatColor } from '@/utils/colorDiff'

type DiffMode = 'rgb' | 'deltae'

const imgA = ref<HTMLImageElement | null>(null)
const imgB = ref<HTMLImageElement | null>(null)
const nameA = ref('')
const nameB = ref('')
const diffCanvasRef = ref<HTMLCanvasElement | null>(null)
const histCanvasRef = ref<HTMLCanvasElement | null>(null)

// 差异模式：'rgb' = sRGB 通道直接差，'deltae' = ΔE2000 感知色差
const diffMode = ref<DiffMode>('deltae')

// 差异放大多倍（仅 RGB 模式使用）
const amplify = ref(10)

// ΔE 颜色映射的上限（超过这个值都显示为最红）
const deltaeMax = ref(10)

// 统计数据
const maxDiff = ref(0)
const avgDiff = ref(0)
const diffPixels = ref(0)
const totalPixels = ref(0)
// ΔE 专用统计
const maxDeltaE = ref(0)
const avgDeltaE = ref(0)
const jndPixels = ref(0) // ΔE > 1 (JND) 的像素数
const noticablePixels = ref(0) // ΔE > 2 的像素数

// 直方图数据（100 个 bin）
const histogram = ref<number[]>([])

const canCompute = computed(() => imgA.value && imgB.value)

const sizeMismatch = computed(() => {
  if (!imgA.value || !imgB.value) return false
  return imgA.value.width !== imgB.value.width || imgB.value.height !== imgA.value.height
})

// ==================== 加载图片 ====================

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

async function handleFileA(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    imgA.value = await loadImageFromFile(file)
    nameA.value = file.name
    computeDiff()
  } catch (err) {
    alert('图片 A 加载失败')
  }
  ;(e.target as HTMLInputElement).value = ''
}

async function handleFileB(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    imgB.value = await loadImageFromFile(file)
    nameB.value = file.name
    computeDiff()
  } catch (err) {
    alert('图片 B 加载失败')
  }
  ;(e.target as HTMLInputElement).value = ''
}

// ==================== 计算差异 ====================

function getImageData(img: HTMLImageElement): ImageData {
  const w = img.width
  const h = img.height
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, w, h)
}

function computeDiff(): void {
  if (!imgA.value || !imgB.value || !diffCanvasRef.value) return

  const a = imgA.value
  const b = imgB.value
  const w = a.width
  const h = a.height

  if (w !== b.width || h !== b.height) return

  const canvas = diffCanvasRef.value
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dataA = getImageData(a).data
  const dataB = getImageData(b).data
  const outData = ctx.createImageData(w, h)
  const out = outData.data

  const total = w * h
  const mode = diffMode.value

  // 统计
  let maxD = 0
  let sumD = 0
  let diffCount = 0
  let maxDE = 0
  let sumDE = 0
  let jndCount = 0
  let noticableCount = 0

  // 直方图（ΔE 模式用 0~max 分 100 档；RGB 模式用 0~255 分 100 档）
  const histBins = 100
  histogram.value = new Array(histBins).fill(0)
  const hist = histogram.value

  const amp = amplify.value
  const dMax = deltaeMax.value

  for (let i = 0; i < total; i++) {
    const idx = i * 4
    const rA = dataA[idx]
    const gA = dataA[idx + 1]
    const bA = dataA[idx + 2]
    const rB = dataB[idx]
    const gB = dataB[idx + 1]
    const bB = dataB[idx + 2]

    // RGB 模式
    const dr = Math.abs(rA - rB)
    const dg = Math.abs(gA - gB)
    const db = Math.abs(bA - bB)
    const d = Math.max(dr, dg, db)
    if (d > 0) diffCount++
    if (d > maxD) maxD = d
    sumD += d

    if (mode === 'rgb') {
      // RGB 通道差显示（放大）
      out[idx] = Math.min(255, dr * amp)
      out[idx + 1] = Math.min(255, dg * amp)
      out[idx + 2] = Math.min(255, db * amp)
      out[idx + 3] = 255

      const histIdx = Math.min(histBins - 1, Math.floor((d / 255) * histBins))
      hist[histIdx]++
    } else {
      // ΔE2000 模式
      const lab1 = srgbToLab(rA, gA, bA)
      const lab2 = srgbToLab(rB, gB, bB)
      const de = ciede2000(lab1, lab2)

      if (de > maxDE) maxDE = de
      sumDE += de
      if (de > 1) jndCount++
      if (de > 2) noticableCount++

      // 伪彩色
      const [hr, hg, hb] = heatColor(de, dMax)
      out[idx] = hr
      out[idx + 1] = hg
      out[idx + 2] = hb
      out[idx + 3] = 255

      const histIdx = Math.min(histBins - 1, Math.floor((de / dMax) * histBins))
      hist[histIdx]++
    }
  }

  ctx.putImageData(outData, 0, 0)

  maxDiff.value = maxD
  avgDiff.value = total > 0 ? sumD / total : 0
  diffPixels.value = diffCount
  totalPixels.value = total
  maxDeltaE.value = maxDE
  avgDeltaE.value = total > 0 ? sumDE / total : 0
  jndPixels.value = jndCount
  noticablePixels.value = noticableCount

  // 画直方图
  drawHistogram()
}

// ==================== 直方图 ====================

function drawHistogram(): void {
  const canvas = histCanvasRef.value
  if (!canvas) return

  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, w, h)

  const histData = histogram.value
  const maxVal = Math.max(...histData, 1)
  const bins = histData.length
  const barW = w / bins

  for (let i = 0; i < bins; i++) {
    const barH = (histData[i] / maxVal) * (h - 20)

    if (diffMode.value === 'deltae') {
      const val = (i / bins) * deltaeMax.value
      const [r, g, b] = heatColor(val, deltaeMax.value)
      ctx.fillStyle = `rgb(${r},${g},${b})`
    } else {
      ctx.fillStyle = '#888'
    }

    ctx.fillRect(i * barW, h - barH - 16, barW - 1, barH)
  }

  // 底部刻度标签
  ctx.fillStyle = '#999'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('0', 2, h - 3)
  ctx.textAlign = 'right'
  ctx.fillText(diffMode.value === 'deltae' ? `ΔE ${deltaeMax.value}` : '255', w - 2, h - 3)

  // JND 线（仅 ΔE 模式）
  if (diffMode.value === 'deltae') {
    const jndX = (1 / deltaeMax.value) * w
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(jndX, 0)
    ctx.lineTo(jndX, h - 16)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('JND=1', jndX + 2, 12)
  }
}

// ==================== 导出数据 ====================

const copyStatus = ref('')

function copyStats(): void {
  if (!canCompute.value || sizeMismatch.value) return

  const lines: string[] = []
  lines.push('=== 图片差分对比结果 ===')
  lines.push(`图片 A：${nameA.value}`)
  lines.push(`图片 B：${nameB.value}`)
  lines.push(`尺寸：${imgA.value?.width} × ${imgA.value?.height}`)
  lines.push(`模式：${diffMode.value === 'deltae' ? 'ΔE 2000 (感知色差)' : 'RGB 通道差'}`)
  if (diffMode.value === 'deltae') {
    lines.push(`色标上限：ΔE ${deltaeMax.value}`)
  } else {
    lines.push(`放大倍率：${amplify.value}×`)
  }
  lines.push('')

  if (diffMode.value === 'deltae') {
    lines.push(`最大 ΔE：${maxDeltaE.value.toFixed(3)}`)
    lines.push(`平均 ΔE：${avgDeltaE.value.toFixed(4)}`)
    lines.push(
      `可察觉像素 (ΔE>1)：${jndPixels.value.toLocaleString()} (${((jndPixels.value / totalPixels.value) * 100).toFixed(2)}%)`,
    )
    lines.push(
      `明显差异像素 (ΔE>2)：${noticablePixels.value.toLocaleString()} (${((noticablePixels.value / totalPixels.value) * 100).toFixed(2)}%)`,
    )
    lines.push('')
    lines.push('直方图（100 bins，从左到右 ΔE 从小到大）：')
    lines.push(histogram.value.join(', '))
  } else {
    lines.push(`最大差异：${maxDiff.value} / 255`)
    lines.push(`平均差异：${avgDiff.value.toFixed(4)} / 255`)
    lines.push(
      `差异像素：${diffPixels.value.toLocaleString()} / ${totalPixels.value.toLocaleString()}`,
    )
    lines.push('')
    lines.push('直方图（100 bins，从左到右差值从小到大）：')
    lines.push(histogram.value.join(', '))
  }

  const text = lines.join('\n')
  navigator.clipboard
    .writeText(text)
    .then(() => {
      copyStatus.value = '✅ 已复制'
      setTimeout(() => {
        copyStatus.value = ''
      }, 2000)
    })
    .catch(() => {
      copyStatus.value = '❌ 复制失败'
      setTimeout(() => {
        copyStatus.value = ''
      }, 2000)
    })
}

// ==================== 事件 ====================

function setMode(mode: DiffMode): void {
  diffMode.value = mode
  computeDiff()
}

function handleAmplifyChange(e: Event): void {
  amplify.value = Number((e.target as HTMLInputElement).value)
  if (diffMode.value === 'rgb') computeDiff()
}

function handleDeltaeMaxChange(e: Event): void {
  deltaeMax.value = Number((e.target as HTMLInputElement).value)
  if (diffMode.value === 'deltae') computeDiff()
}

function downloadDiff(): void {
  if (!diffCanvasRef.value) return
  diffCanvasRef.value.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download =
      diffMode.value === 'deltae'
        ? `diff_deltae_${deltaeMax.value}max.png`
        : `diff_rgb_${amplify.value}x.png`
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
</script>

<template>
  <div class="diff-container">
    <h2>🔍 图片差分对比工具</h2>

    <!-- 上传区 -->
    <div class="upload-row">
      <label class="upload-card">
        <span class="upload-label">图片 A（原图）</span>
        <span class="upload-name">{{ nameA || '未选择' }}</span>
        <input type="file" accept="image/*" @change="handleFileA" />
      </label>
      <div class="vs">VS</div>
      <label class="upload-card">
        <span class="upload-label">图片 B（对比图）</span>
        <span class="upload-name">{{ nameB || '未选择' }}</span>
        <input type="file" accept="image/*" @change="handleFileB" />
      </label>
    </div>

    <!-- 模式切换 -->
    <div class="mode-row">
      <div class="mode-tabs">
        <button
          class="mode-btn"
          :class="{ active: diffMode === 'deltae' }"
          @click="setMode('deltae')"
        >
          🎨 ΔE 2000（感知色差）
        </button>
        <button class="mode-btn" :class="{ active: diffMode === 'rgb' }" @click="setMode('rgb')">
          🔴 RGB 通道差
        </button>
      </div>

      <div v-if="canCompute && !sizeMismatch" class="controls">
        <template v-if="diffMode === 'rgb'">
          <div class="slider-group">
            <span>放大：</span>
            <input type="range" min="1" max="100" :value="amplify" @input="handleAmplifyChange" />
            <input
              type="number"
              min="1"
              max="100"
              :value="amplify"
              style="width: 56px"
              @input="handleAmplifyChange"
            />
            <span class="slider-val">{{ amplify }}×</span>
          </div>
        </template>
        <template v-else>
          <div class="slider-group">
            <span>色标上限 ΔE：</span>
            <input
              type="range"
              min="1"
              max="50"
              :value="deltaeMax"
              @input="handleDeltaeMaxChange"
            />
            <input
              type="number"
              min="1"
              max="50"
              :value="deltaeMax"
              style="width: 56px"
              @input="handleDeltaeMaxChange"
            />
            <span class="slider-val">{{ deltaeMax }}</span>
          </div>
        </template>

        <button class="copy-btn" :disabled="!canCompute || sizeMismatch" @click="copyStats">
          📋 {{ copyStatus || '复制数据' }}
        </button>
        <button class="download-btn" @click="downloadDiff">💾 下载差异图</button>
      </div>
    </div>

    <!-- 尺寸不匹配警告 -->
    <div v-if="sizeMismatch" class="warning">
      ⚠️ 两张图片尺寸不一致，无法对比
      <br />
      A: {{ imgA?.width }} × {{ imgA?.height }} &nbsp;|&nbsp; B: {{ imgB?.width }} ×
      {{ imgB?.height }}
    </div>

    <!-- 统计信息 -->
    <div v-if="canCompute && !sizeMismatch" class="stats-row">
      <div class="stat-item">
        <span class="stat-label">尺寸</span>
        <span class="stat-value">{{ imgA?.width }} × {{ imgA?.height }}</span>
      </div>

      <template v-if="diffMode === 'deltae'">
        <div class="stat-item">
          <span class="stat-label">最大 ΔE</span>
          <span class="stat-value" :class="{ bad: maxDeltaE > 2, warn: maxDeltaE > 1 }">
            {{ maxDeltaE.toFixed(2) }}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">平均 ΔE</span>
          <span class="stat-value" :class="{ bad: avgDeltaE > 2, warn: avgDeltaE > 1 }">
            {{ avgDeltaE.toFixed(3) }}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">可察觉 (ΔE>1)</span>
          <span class="stat-value">
            {{ jndPixels.toLocaleString() }}
            ({{ totalPixels ? ((jndPixels / totalPixels) * 100).toFixed(2) : 0 }}%)
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">明显差异 (ΔE>2)</span>
          <span class="stat-value">
            {{ noticablePixels.toLocaleString() }}
            ({{ totalPixels ? ((noticablePixels / totalPixels) * 100).toFixed(2) : 0 }}%)
          </span>
        </div>
      </template>

      <template v-else>
        <div class="stat-item">
          <span class="stat-label">最大差异</span>
          <span class="stat-value">{{ maxDiff }} / 255</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">平均差异</span>
          <span class="stat-value">{{ avgDiff.toFixed(3) }} / 255</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">差异像素</span>
          <span class="stat-value">
            {{ diffPixels.toLocaleString() }} / {{ totalPixels.toLocaleString() }}
          </span>
        </div>
      </template>
    </div>

    <!-- 直方图 -->
    <div v-if="canCompute && !sizeMismatch" class="histogram-wrap">
      <div class="histogram-label">
        {{ diffMode === 'deltae' ? 'ΔE 分布直方图' : 'RGB 差值分布直方图' }}
      </div>
      <canvas ref="histCanvasRef" width="800" height="80" class="hist-canvas" />
    </div>

    <!-- 差异图显示 -->
    <div class="canvas-wrap">
      <div v-if="!canCompute || sizeMismatch" class="placeholder">
        请上传两张相同分辨率的图片进行对比
      </div>
      <canvas v-show="canCompute && !sizeMismatch" ref="diffCanvasRef" class="diff-canvas" />
    </div>

    <div class="hint">
      <template v-if="diffMode === 'deltae'">
        💡 ΔE 2000 是感知色差的工业标准。ΔE &lt; 1 为「刚好可察觉差 (JND)」，ΔE &lt; 2
        普通人眼基本看不出区别。 颜色从蓝（无差异）→ 青 → 绿 → 黄 → 红（最大差异）渐变。
      </template>
      <template v-else>
        💡 RGB 模式直接在 sRGB 编码空间做差。R/G/B 通道差异分别显示为红/绿/蓝色，黑色表示完全一致。
        注意：sRGB 是非线性空间，数值差不等于感知差，仅供定位差异位置用。
      </template>
    </div>
  </div>
</template>

<style scoped>
.diff-container {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100vh;
  box-sizing: border-box;
}

h2 {
  margin: 0;
  font-size: 18px;
}

.upload-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.upload-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  border: 2px dashed #ccc;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  background: #fafafa;
}

.upload-card:hover {
  border-color: #007aff;
  background: #f0f7ff;
}

.upload-card input {
  display: none;
}

.upload-label {
  font-size: 12px;
  color: #666;
  font-weight: 600;
}

.upload-name {
  font-size: 13px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vs {
  font-weight: 700;
  color: #999;
  font-size: 14px;
  flex-shrink: 0;
}

.mode-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
  padding: 8px 12px;
  background: #f5f5f5;
  border-radius: 8px;
  flex-wrap: wrap;
}

.mode-tabs {
  display: flex;
  border: 1px solid #ddd;
  border-radius: 6px;
  overflow: hidden;
}

.mode-btn {
  padding: 6px 14px;
  background: #fff;
  color: #666;
  border: none;
  font-size: 12px;
  cursor: pointer;
  border-right: 1px solid #ddd;
  transition: all 0.15s;
}

.mode-btn:last-child {
  border-right: none;
}

.mode-btn.active {
  background: #007aff;
  color: #fff;
}

.mode-btn:not(.active):hover {
  background: #f9f9f9;
}

.controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.slider-group {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.slider-group input[type='range'] {
  width: 180px;
}

.slider-val {
  min-width: 40px;
  text-align: right;
  color: #666;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.copy-btn {
  padding: 6px 14px;
  background: #007aff;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.copy-btn:hover {
  background: #0062cc;
}

.copy-btn:disabled {
  background: #c0c0c0;
  cursor: not-allowed;
}

.download-btn {
  padding: 6px 14px;
  background: #34c759;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.download-btn:hover {
  background: #28a745;
}

.warning {
  padding: 10px 14px;
  background: #fff3cd;
  border: 1px solid #ffeaa7;
  color: #856404;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  flex-shrink: 0;
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  flex-shrink: 0;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 11px;
  color: #999;
}

.stat-value {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  font-variant-numeric: tabular-nums;
}

.stat-value.warn {
  color: #ff9500;
}

.stat-value.bad {
  color: #ff3b30;
}

.histogram-wrap {
  flex-shrink: 0;
  background: #2a2a2a;
  border-radius: 8px;
  padding: 8px 12px;
}

.histogram-label {
  font-size: 11px;
  color: #999;
  margin-bottom: 4px;
}

.hist-canvas {
  width: 100%;
  height: 80px;
  display: block;
}

.canvas-wrap {
  flex: 1;
  min-height: 0;
  background: #1a1a1a;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 12px;
}

.diff-canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.placeholder {
  color: #666;
  font-size: 14px;
}

.hint {
  font-size: 12px;
  color: #888;
  flex-shrink: 0;
  line-height: 1.5;
}
</style>
