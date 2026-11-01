<script setup>
import { ref, computed } from 'vue'
import SVGTool from '../lib/svgtool.js'
import { T } from '../lib/i18n.dev.js'

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

function loadSample() { source.value = SAMPLE; output.value = ''; setMsg('info', T('svg.loadedSample')) }
function clearAll() { source.value = ''; output.value = ''; message.value = null }
function onPickFile() { fileInput.value && fileInput.value.click() }
function onFile(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  const r = new FileReader()
  r.onload = () => { source.value = String(r.result); output.value = ''; setMsg('ok', T('svg.loadedFile', { name: f.name })); }
  r.readAsText(f)
  e.target.value = ''
}

function runInfo() {
  if (!source.value.trim()) return setMsg('err', T('svg.needSource'))
  const s = SVGTool.getSize(source.value)
  const cols = SVGTool.extractColors(source.value)
  const vb = SVGTool.getViewBox(source.value)
  output.value = [
    T('svg.infoViewBox', { v: vb ? vb.join(' ') : T('svg.none') }),
    T('svg.infoWidth', { v: s.width ?? T('svg.none') }),
    T('svg.infoHeight', { v: s.height ?? T('svg.none') }),
    T('svg.infoColorCount', { n: cols.length }),
    T('svg.infoColors', { v: cols.join(', ') || T('svg.none') }),
  ].join('\n')
  setMsg('ok', T('svg.parsed', { w: s.width ?? '?', h: s.height ?? '?', n: cols.length }))
}

function runCompress(extreme) {
  if (!source.value.trim()) return setMsg('err', T('svg.needSource'))
  output.value = extreme ? SVGTool.extremeCompress(source.value) : SVGTool.compress(source.value)
  setMsg('ok', T('svg.compressed'))
}

function runFormat() {
  if (!source.value.trim()) return setMsg('err', T('svg.needSource'))
  output.value = SVGTool.format(source.value)
  setMsg('ok', T('svg.formatted'))
}
function runMinify() {
  if (!source.value.trim()) return setMsg('err', T('svg.needSource'))
  output.value = SVGTool.minify(source.value)
  setMsg('ok', T('svg.minified'))
}

function runResize() {
  if (!source.value.trim()) return setMsg('err', T('svg.needSource'))
  let r = source.value
  try {
    if (resizeMode.value === 'width') r = SVGTool.resizeToWidth(source.value, Number(dimW.value))
    else if (resizeMode.value === 'height') r = SVGTool.resizeToHeight(source.value, Number(dimH.value))
    else if (resizeMode.value === 'contain') r = SVGTool.resizeContain(source.value, Number(dimW.value), Number(dimH.value))
    else if (resizeMode.value === 'cover') r = SVGTool.resizeCover(source.value, Number(dimW.value), Number(dimH.value))
    else if (resizeMode.value === 'set') r = SVGTool.setSize(source.value, Number(dimW.value), Number(dimH.value))
    else if (resizeMode.value === 'viewbox') r = SVGTool.resizeViewBox(source.value, Number(dimW.value), Number(dimH.value))
    output.value = r
    setMsg('ok', T('svg.resized'))
  } catch (e) { setMsg('err', T('svg.resizeFailed', { msg: e.message || e })) }
}

function runRecolor() {
  if (!source.value.trim()) return setMsg('err', T('svg.needSource'))
  if (!selColor.value) return setMsg('err', T('svg.needColor'))
  output.value = SVGTool.replaceColor(source.value, selColor.value, newColor.value)
  setMsg('ok', T('svg.recolored', { from: selColor.value, to: newColor.value }))
}

function runBase64() {
  if (!source.value.trim()) return setMsg('err', T('svg.needSource'))
  if (b64mode.value === 'encode') {
    output.value = SVGTool.addDataURIPrefix(SVGTool.toBase64(source.value))
    setMsg('ok', T('svg.encoded'))
  } else {
    const raw = SVGTool.removeDataURIPrefix(source.value.trim())
    try { output.value = SVGTool.fromBase64(raw) } catch (e) { return setMsg('err', T('svg.decodeFailed', { msg: e.message || e })) }
    setMsg('ok', T('svg.decoded'))
  }
}

function runOptimize() {
  if (!source.value.trim()) return setMsg('err', T('svg.needSource'))
  const rep = SVGTool.analyzeOptimization(source.value)
  const lines = rep.issues.length
    ? rep.issues.map((i) => T('svg.optIssue', { severity: i.severity, msg: i.msg, detail: i.detail, savings: i.savings }))
    : [T('svg.noOptimize')]
  output.value = `${T('svg.origSize', { n: rep.originalSize })}\n${T('svg.savings', { n: rep.potentialSavings })}\n\n${lines.join('\n')}`
  setMsg('ok', T('svg.analyzed', { n: rep.potentialSavings }))
}

const TABS = computed(() => [
  { id: 'info', label: T('svg.tabInfo') },
  { id: 'compress', label: T('svg.tabCompress') },
  { id: 'format', label: T('svg.tabFormat') },
  { id: 'resize', label: T('svg.tabResize') },
  { id: 'recolor', label: T('svg.tabRecolor') },
  { id: 'base64', label: T('svg.tabBase64') },
  { id: 'optimize', label: T('svg.tabOptimize') },
])

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
  <h1 class="page-title">{{ T('svg.title') }}</h1>
  <p class="page-sub">
    {{ T('svg.subtitle') }}
  </p>

  <div class="panel">
    <div class="row wrap">
      <button class="btn" type="button" @click="loadSample"><i class="bi bi-lightning-charge"></i> {{ T('svg.loadSample') }}</button>
      <button class="btn ghost" type="button" @click="onPickFile"><i class="bi bi-folder2-open"></i> {{ T('svg.pickFile') }}</button>
      <button class="btn ghost" type="button" @click="clearAll"><i class="bi bi-eraser"></i> {{ T('svg.clear') }}</button>
      <input ref="fileInput" type="file" accept=".svg,image/svg+xml" hidden @change="onFile" />
    </div>

    <label class="field" style="margin-top:10px">
      <span>{{ T('svg.source') }}</span>
      <textarea v-model="source" rows="8" spellcheck="false" :placeholder="T('svg.sourcePh')"></textarea>
    </label>

    <div v-if="previewHTML" class="svg-preview">
      <div class="svg-preview-label">{{ T('svg.preview') }}</div>
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
      <button class="btn" type="button" @click="runCompress(false)"><i class="bi bi-arrows-collapse"></i> {{ T('svg.standardCompress') }}</button>
      <button class="btn ghost" type="button" @click="runCompress(true)"><i class="bi bi-battery-half"></i> {{ T('svg.extremeCompress') }}</button>
    </div>
    <p class="hint">{{ T('svg.compressHint') }}</p>
  </div>

  <!-- 美化 -->
  <div v-else-if="tab === 'format'" class="panel">
    <div class="row wrap">
      <button class="btn" type="button" @click="runFormat"><i class="bi bi-body-text"></i> {{ T('svg.formatBtn') }}</button>
      <button class="btn ghost" type="button" @click="runMinify"><i class="bi bi-text-wrap"></i> {{ T('svg.minifyBtn') }}</button>
    </div>
  </div>

  <!-- 缩放 -->
  <div v-else-if="tab === 'resize'" class="panel">
    <div class="row wrap">
      <div class="field">
        <span>{{ T('svg.mode') }}</span>
        <select v-model="resizeMode">
          <option value="width">{{ T('svg.modeWidth') }}</option>
          <option value="height">{{ T('svg.modeHeight') }}</option>
          <option value="set">{{ T('svg.modeSet') }}</option>
          <option value="contain">{{ T('svg.modeContain') }}</option>
          <option value="cover">{{ T('svg.modeCover') }}</option>
          <option value="viewbox">{{ T('svg.modeViewBox') }}</option>
        </select>
      </div>
      <div class="field">
        <span>{{ T('svg.dimW') }}</span>
        <input type="number" v-model="dimW" style="width:110px" />
      </div>
      <div class="field" v-if="resizeMode !== 'width'">
        <span>{{ T('svg.dimH') }}</span>
        <input type="number" v-model="dimH" style="width:110px" />
      </div>
      <button class="btn" type="button" @click="runResize"><i class="bi bi-arrows-fullscreen"></i> {{ T('svg.resizeBtn') }}</button>
    </div>
  </div>

  <!-- 重着色 -->
  <div v-else-if="tab === 'recolor'" class="panel">
    <template v-if="colors.length">
      <div class="row wrap">
        <div class="field">
          <span>{{ T('svg.selColor') }}</span>
          <select v-model="selColor">
            <option v-for="c in colors" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="field">
          <span>{{ T('svg.newColor') }}</span>
          <input type="color" v-model="newColor" style="width:54px;height:38px;padding:2px" />
        </div>
        <button class="btn" type="button" @click="runRecolor"><i class="bi bi-droplet"></i> {{ T('svg.replaceBtn') }}</button>
      </div>
      <div class="palette">
        <span v-for="c in colors" :key="c" class="swatch" :style="{ background: c }" :title="c"></span>
      </div>
    </template>
    <p v-else class="hint">{{ T('svg.noColorHint') }}</p>
  </div>

  <!-- 编码 -->
  <div v-else-if="tab === 'base64'" class="panel">
    <div class="row wrap">
      <div class="field">
        <span>{{ T('svg.direction') }}</span>
        <select v-model="b64mode">
          <option value="encode">{{ T('svg.encodeB64') }}</option>
          <option value="decode">{{ T('svg.decodeB64') }}</option>
        </select>
      </div>
      <button class="btn" type="button" @click="runBase64"><i class="bi bi-code-slash"></i> {{ T('svg.run') }}</button>
    </div>
  </div>

  <!-- 优化 -->
  <div v-else-if="tab === 'optimize'" class="panel">
    <div class="row wrap">
      <button class="btn" type="button" @click="runOptimize"><i class="bi bi-graph-up"></i> {{ T('svg.analyzeBtn') }}</button>
    </div>
  </div>

  <!-- 信息（默认） -->
  <div v-else class="panel">
    <div class="row wrap">
      <button class="btn" type="button" @click="runInfo"><i class="bi bi-info-circle"></i> {{ T('svg.infoBtn') }}</button>
    </div>
    <p class="hint">{{ T('svg.infoHint') }}</p>
  </div>

  <!-- 输出 -->
  <div v-if="output" class="panel">
    <div class="row wrap" style="margin-top:0">
      <span v-if="sizeInfo" class="kpi"><span class="num">{{ sizeInfo.ratio }}%</span><span class="lbl">{{ T('svg.sizeChange', { o: sizeInfo.o, n: sizeInfo.n }) }}</span></span>
      <button class="btn ghost sm" type="button" @click="copyOutput"><i class="bi bi-clipboard"></i> {{ T('svg.copy') }}</button>
      <button class="btn green sm" type="button" @click="downloadOutput"><i class="bi bi-download"></i> {{ T('svg.download') }}</button>
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
