<script setup>
import { ref, computed } from 'vue'
import SVGTool from '../lib/svgtool.js'

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <!-- 示例图标 -->
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="44" fill="url(#g)" opacity="0.9"/>
  <path d="M30 52 L46 68 L72 36" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

const source = ref('')
const tab = ref('info')
const output = ref('')
const message = ref(null)

const fileInput = ref(null)

const previewHTML = computed(() =>
  source.value.trim() ? SVGTool.sanitizeSVG(source.value) : '')

const colors = computed(() => (source.value ? SVGTool.extractColors(source.value) : []))
const selColor = ref('#38bdf8')
const newColor = ref('#34d399')

const resizeMode = ref('width')
const dimW = ref(64)
const dimH = ref(64)

const b64mode = ref('encode')

const sizeInfo = computed(() => {
  const o = source.value.length
  const n = output.value.length
  if (!o) return null
  const ratio = n ? Math.round((1 - n / o) * 100) : 0
  return { o, n, ratio }
})

function setMsg(type, text) { message.value = { type, text } }

function loadSample() { source.value = SAMPLE; output.value = ''; setMsg('info', '已载入示例 SVG。') }
function clearAll() { source.value = ''; output.value = ''; message.value = null }
function onPickFile() { fileInput.value && fileInput.value.click() }
function onFile(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  const r = new FileReader()
  r.onload = () => { source.value = String(r.result); output.value = ''; setMsg('ok', `已载入 ${f.name}`); }
  r.readAsText(f)
  e.target.value = ''
}

function runInfo() {
  if (!source.value.trim()) return setMsg('err', '请输入 SVG 源码。')
  const s = SVGTool.getSize(source.value)
  const cols = SVGTool.extractColors(source.value)
  const vb = SVGTool.getViewBox(source.value)
  output.value = [
    `viewBox: ${vb ? vb.join(' ') : '(无)'}`,
    `width:   ${s.width ?? '(无)'}`,
    `height:  ${s.height ?? '(无)'}`,
    `颜色数:  ${cols.length}`,
    `颜色:    ${cols.join(', ') || '(无)'}`,
  ].join('\n')
  setMsg('ok', `解析完成：尺寸 ${s.width ?? '?'} × ${s.height ?? '?'}，提取 ${cols.length} 种颜色。`)
}

function runCompress(extreme) {
  if (!source.value.trim()) return setMsg('err', '请输入 SVG 源码。')
  output.value = extreme ? SVGTool.extremeCompress(source.value) : SVGTool.compress(source.value)
  setMsg('ok', '压缩完成。')
}

function runFormat() {
  if (!source.value.trim()) return setMsg('err', '请输入 SVG 源码。')
  output.value = SVGTool.format(source.value)
  setMsg('ok', '已格式化（带缩进）。')
}
function runMinify() {
  if (!source.value.trim()) return setMsg('err', '请输入 SVG 源码。')
  output.value = SVGTool.minify(source.value)
  setMsg('ok', '已最小化。')
}

function runResize() {
  if (!source.value.trim()) return setMsg('err', '请输入 SVG 源码。')
  let r = source.value
  try {
    if (resizeMode.value === 'width') r = SVGTool.resizeToWidth(source.value, Number(dimW.value))
    else if (resizeMode.value === 'height') r = SVGTool.resizeToHeight(source.value, Number(dimH.value))
    else if (resizeMode.value === 'contain') r = SVGTool.resizeContain(source.value, Number(dimW.value), Number(dimH.value))
    else if (resizeMode.value === 'cover') r = SVGTool.resizeCover(source.value, Number(dimW.value), Number(dimH.value))
    else if (resizeMode.value === 'set') r = SVGTool.setSize(source.value, Number(dimW.value), Number(dimH.value))
    else if (resizeMode.value === 'viewbox') r = SVGTool.resizeViewBox(source.value, Number(dimW.value), Number(dimH.value))
    output.value = r
    setMsg('ok', '缩放完成。')
  } catch (e) { setMsg('err', '缩放失败：' + (e.message || e)) }
}

function runRecolor() {
  if (!source.value.trim()) return setMsg('err', '请输入 SVG 源码。')
  if (!selColor.value) return setMsg('err', '请选择要替换的颜色。')
  output.value = SVGTool.replaceColor(source.value, selColor.value, newColor.value)
  setMsg('ok', `已将 ${selColor.value} 替换为 ${newColor.value}。`)
}

function runBase64() {
  if (!source.value.trim()) return setMsg('err', '请输入 SVG 源码。')
  if (b64mode.value === 'encode') {
    output.value = SVGTool.addDataURIPrefix(SVGTool.toBase64(source.value))
    setMsg('ok', '已编码为 Base64 Data URI，可直接用于 <img src> 或 CSS background。')
  } else {
    const raw = SVGTool.removeDataURIPrefix(source.value.trim())
    try { output.value = SVGTool.fromBase64(raw) } catch (e) { return setMsg('err', '解码失败：' + (e.message || e)) }
    setMsg('ok', '已解码为 SVG 源码。')
  }
}

function runOptimize() {
  if (!source.value.trim()) return setMsg('err', '请输入 SVG 源码。')
  const rep = SVGTool.analyzeOptimization(source.value)
  const lines = rep.issues.length
    ? rep.issues.map((i) => `· [${i.severity}] ${i.msg}\n  ${i.detail}（≈ 可省 ${i.savings} 字节）`)
    : ['未发现明显可优化项，已较精简。']
  output.value = `原始大小: ${rep.originalSize} 字节\n预计可省: ${rep.potentialSavings} 字节\n\n${lines.join('\n')}`
  setMsg('ok', `分析完成：预计可节省 ${rep.potentialSavings} 字节。`)
}

const TABS = [
  { id: 'info', label: '信息' },
  { id: 'compress', label: '压缩' },
  { id: 'format', label: '美化' },
  { id: 'resize', label: '缩放' },
  { id: 'recolor', label: '重着色' },
  { id: 'base64', label: '编码' },
  { id: 'optimize', label: '优化' },
]

function copyOutput() { output.value && navigator.clipboard && navigator.clipboard.writeText(output.value) }
function downloadOutput() {
  if (!output.value) return
  const blob = new Blob([output.value], { type: 'image/svg+xml' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'output.svg'
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <h1 class="page-title">SVG 工具箱</h1>
  <p class="page-sub">
    纯浏览器端 SVG 处理：解析 · 压缩 · 美化 · 缩放 · 重着色 · Base64 · 优化分析。文件与文本均不上传，零依赖。
  </p>

  <div class="panel">
    <div class="row wrap">
      <button class="btn" type="button" @click="loadSample"><i class="bi bi-lightning-charge"></i> 载入示例</button>
      <button class="btn ghost" type="button" @click="onPickFile"><i class="bi bi-folder2-open"></i> 选择 .svg 文件</button>
      <button class="btn ghost" type="button" @click="clearAll"><i class="bi bi-eraser"></i> 清空</button>
      <input ref="fileInput" type="file" accept=".svg,image/svg+xml" hidden @change="onFile" />
    </div>

    <label class="field" style="margin-top:10px">
      <span>SVG 源码</span>
      <textarea v-model="source" rows="8" spellcheck="false" placeholder="在此粘贴 SVG 源码，或点击「选择 .svg 文件」…"></textarea>
    </label>

    <div v-if="previewHTML" class="svg-preview">
      <div class="svg-preview-label">实时预览（已净化）</div>
      <div class="svg-preview-box" v-html="previewHTML"></div>
    </div>
  </div>

  <div class="tabs">
    <button
      v-for="tb in TABS" :key="tb.id" type="button"
      :class="{ active: tab === tb.id }" @click="tab = tb.id"
    >{{ tb.label }}</button>
  </div>

  <!-- 压缩 -->
  <div v-if="tab === 'compress'" class="panel">
    <div class="row wrap">
      <button class="btn" type="button" @click="runCompress(false)"><i class="bi bi-arrows-collapse"></i> 标准压缩</button>
      <button class="btn ghost" type="button" @click="runCompress(true)"><i class="bi bi-battery-half"></i> 极致压缩</button>
    </div>
    <p class="hint">标准压缩保留 class、默认属性；极致压缩会移除 class、t、p-id 等非必要属性，路径精度降至 1 位小数。</p>
  </div>

  <!-- 美化 -->
  <div v-else-if="tab === 'format'" class="panel">
    <div class="row wrap">
      <button class="btn" type="button" @click="runFormat"><i class="bi bi-body-text"></i> 格式化（缩进）</button>
      <button class="btn ghost" type="button" @click="runMinify"><i class="bi bi-text-wrap"></i> 最小化</button>
    </div>
  </div>

  <!-- 缩放 -->
  <div v-else-if="tab === 'resize'" class="panel">
    <div class="row wrap">
      <div class="field">
        <span>模式</span>
        <select v-model="resizeMode">
          <option value="width">按宽度等比</option>
          <option value="height">按高度等比</option>
          <option value="set">固定尺寸</option>
          <option value="contain">Contain 适配</option>
          <option value="cover">Cover 覆盖</option>
          <option value="viewbox">改 viewBox</option>
        </select>
      </div>
      <div class="field">
        <span>宽 / 目标 W</span>
        <input type="number" v-model="dimW" style="width:110px" />
      </div>
      <div class="field" v-if="resizeMode !== 'width'">
        <span>高 / 目标 H</span>
        <input type="number" v-model="dimH" style="width:110px" />
      </div>
      <button class="btn" type="button" @click="runResize"><i class="bi bi-arrows-fullscreen"></i> 缩放</button>
    </div>
  </div>

  <!-- 重着色 -->
  <div v-else-if="tab === 'recolor'" class="panel">
    <template v-if="colors.length">
      <div class="row wrap">
        <div class="field">
          <span>选择颜色</span>
          <select v-model="selColor">
            <option v-for="c in colors" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="field">
          <span>新颜色</span>
          <input type="color" v-model="newColor" style="width:54px;height:38px;padding:2px" />
        </div>
        <button class="btn" type="button" @click="runRecolor"><i class="bi bi-droplet"></i> 替换颜色</button>
      </div>
      <div class="palette">
        <span v-for="c in colors" :key="c" class="swatch" :style="{ background: c }" :title="c"></span>
      </div>
    </template>
    <p v-else class="hint">未提取到颜色，请先输入含 fill/stroke 等颜色的 SVG。</p>
  </div>

  <!-- 编码 -->
  <div v-else-if="tab === 'base64'" class="panel">
    <div class="row wrap">
      <div class="field">
        <span>方向</span>
        <select v-model="b64mode">
          <option value="encode">编码为 Base64</option>
          <option value="decode">从 Base64 解码</option>
        </select>
      </div>
      <button class="btn" type="button" @click="runBase64"><i class="bi bi-code-slash"></i> 执行</button>
    </div>
  </div>

  <!-- 优化 -->
  <div v-else-if="tab === 'optimize'" class="panel">
    <div class="row wrap">
      <button class="btn" type="button" @click="runOptimize"><i class="bi bi-graph-up"></i> 分析可优化项</button>
    </div>
  </div>

  <!-- 信息（默认） -->
  <div v-else class="panel">
    <div class="row wrap">
      <button class="btn" type="button" @click="runInfo"><i class="bi bi-info-circle"></i> 解析信息</button>
    </div>
    <p class="hint">解析 viewBox、尺寸、提取全部颜色。其余可视化操作请切换到上方选项卡。</p>
  </div>

  <!-- 输出 -->
  <div v-if="output" class="panel">
    <div class="row wrap" style="margin-top:0">
      <span v-if="sizeInfo" class="kpi"><span class="num">{{ sizeInfo.ratio }}%</span><span class="lbl">体积变化（原 {{ sizeInfo.o }} → {{ sizeInfo.n }} 字节）</span></span>
      <button class="btn ghost sm" type="button" @click="copyOutput"><i class="bi bi-clipboard"></i> 复制</button>
      <button class="btn green sm" type="button" @click="downloadOutput"><i class="bi bi-download"></i> 下载 output.svg</button>
    </div>
    <textarea v-model="output" rows="10" spellcheck="false" class="out-area"></textarea>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.svg-preview { margin-top: 14px; }
.svg-preview-label { font-size: 11px; color: var(--faint, #6b7a96); margin-bottom: 6px; }
.svg-preview-box {
  background: var(--panel-solid, #121a2c); border: 1px solid var(--line, rgba(120,150,200,.16));
  border-radius: 10px; padding: 16px; text-align: center; min-height: 80px;
  display: flex; align-items: center; justify-content: center;
}
.svg-preview-box :deep(svg) { max-width: 100%; height: auto; }
textarea {
  width: 100%; background: var(--panel-solid, #121a2c); border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  color: var(--txt, #e8edf7); border-radius: 10px; padding: 11px; font-size: 12.5px;
  font-family: var(--mono, monospace); line-height: 1.6; resize: vertical; outline: none; transition: .15s;
}
.out-area { margin-top: 10px; }
textarea:focus { border-color: var(--accent, #38bdf8); box-shadow: 0 0 0 3px rgba(56,189,248,.15); }
.palette { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.swatch { width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--line-strong, rgba(120,150,200,.32)); cursor: pointer; }
.btn.sm { padding: 7px 12px; font-size: 12.5px; }
</style>
