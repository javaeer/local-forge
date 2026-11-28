<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { saveResume, getResume } from '../lib/resume.js'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StepBar from '../components/StepBar.vue'
import StatusPill from '../components/StatusPill.vue'
import { OCR_LANGS, recognizeImage, recognizePdf, onOcrProgress, releaseOcr, parsePages } from '../lib/ocr.js'
import { createZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'
import { consumePending, stashText } from '../lib/workflow.js'
import { pushToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'

const route = useRoute()
const router = useRouter()

const tab = ref('image') // image | pdf
const lang = ref('chi_sim+eng')
const state = ref('idle')
const busy = ref(false)
const message = ref(null)
const progress = ref(0)
const progressLabel = ref('')

/* ---------------- 图片 OCR ---------------- */
const imgFile = ref(null)
const imgPreview = ref('')
const imgResult = ref(null)

/* ---------------- PDF OCR ---------------- */
const pdfFile = ref(null)
const pdfPages = ref('') // 留空=全部
const pdfScale = ref(2)
const pdfResults = ref([])
const pdfTotal = ref(0)
const pdfCurrent = ref(0)

const steps = computed(() => [
  {
    title: tab.value === 'image' ? T('ui.ocr.stepImageTitle') : T('ui.ocr.stepPdfTitle'),
    desc: tab.value === 'image' ? T('ui.ocr.stepImageDesc') : T('ui.ocr.stepPdfDesc'),
    state: (tab.value === 'image' ? imgFile.value : pdfFile.value) ? 'done' : 'todo',
  },
  { title: T('ui.ocr.stepLangTitle'), desc: T('ui.ocr.stepLangDesc'), state: lang.value ? 'done' : 'todo' },
  {
    title: T('ui.ocr.stepStartTitle'),
    desc: T('ui.ocr.stepStartDesc'),
    state: state.value === 'working' ? 'working' : state.value === 'done' ? 'done' : state.value === 'error' ? 'error' : 'todo',
  },
])

const currentLang = computed(() => OCR_LANGS.find((l) => l.id === lang.value))
// 引擎语言表是中文数据，展示层按当前语言映射（size 形如「约 4.6MB」）
function langLabel(l) { return l ? T(`ui.ocr.langLabel.${l.id}`) : '' }
function langSize(l) { return l ? T('ui.ocr.sizeAbout', { n: String(l.size).replace(/[^0-9.]/g, '') + 'MB' }) : '' }
const hasText = computed(() =>
  tab.value === 'image' ? !!(imgResult.value && imgResult.value.text) : pdfResults.value.some((r) => r.text),
)
const allText = computed(() => {
  if (tab.value === 'image') return imgResult.value ? imgResult.value.text : ''
  return pdfResults.value.map((r) => T('ui.ocr.pageBlock', { page: r.page, text: r.text })).join('\n\n')
})

function say(type, text) {
  message.value = { type, text }
}

onMounted(() => {
  const t = route.query.tab
  if (t === 'pdf' || t === 'image') tab.value = t
  // 可恢复任务：恢复上次的识别语言 / PDF 缩放（非敏感选项，不含文件）。
  const snap = getResume('/ocr')
  if (snap && snap.settings) {
    const s = snap.settings
    if (typeof s.lang === 'string') lang.value = s.lang
    if (typeof s.pdfScale === 'number') pdfScale.value = s.pdfScale
    if (!t && (s.tab === 'pdf' || s.tab === 'image')) tab.value = s.tab
  }
  onOcrProgress((p) => {
    progress.value = p.percent
    progressLabel.value =
      p.stage === 'lang' ? T('ui.ocr.progressLang', { lang: currentLang.value ? langLabel(currentLang.value) : lang.value }) : T('ui.ocr.progressRecognizing')
  })
  // 跨工具工作流：接收上一步传来的图片/PDF
  const pending = consumePending()
  if (pending && pending.files.length) {
    const f = pending.files[0]
    if (/^image\//.test(f.type)) { tab.value = 'image'; onImageFiles([f]) }
    else if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') { tab.value = 'pdf'; onPdfFiles([f]) }
    pushToast('info', T('ui.ocr.toastLoaded', { from: pending.from }))
  }
})
watch([lang, tab, pdfScale], () => {
  saveResume({
    toolId: '/ocr', route: '/ocr',
    settings: { lang: lang.value, tab: tab.value, pdfScale: pdfScale.value },
  })
})

onBeforeUnmount(() => {
  onOcrProgress(null)
  releaseOcr()
})

async function onImageFiles(files) {
  const f = files && files[0]
  if (!f) return
  if (!/^image\//.test(f.type)) {
    state.value = 'error'
    return say('err', T('ui.ocr.errNotImage', { name: f.name }))
  }
  imgFile.value = f
  imgResult.value = null
  message.value = null
  state.value = 'idle'
  if (imgPreview.value) URL.revokeObjectURL(imgPreview.value)
  imgPreview.value = URL.createObjectURL(f)
  say('info', T('ui.ocr.okImageLoaded', { name: f.name, size: formatSize(f.size) }))
}

async function onPdfFiles(files) {
  const f = files && files[0]
  if (!f) return
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
    state.value = 'error'
    return say('err', T('ui.ocr.errNotPdf', { name: f.name }))
  }
  pdfFile.value = f
  pdfResults.value = []
  message.value = null
  state.value = 'idle'
  say('info', T('ui.ocr.okPdfLoaded', { name: f.name, size: formatSize(f.size) }))
}

async function runImage() {
  if (!imgFile.value) return say('err', T('ui.ocr.errSelectImage'))
  busy.value = true
  state.value = 'working'
  progress.value = 0
  message.value = null
  try {
    const r = await recognizeImage(imgFile.value, { lang: lang.value })
    imgResult.value = r
    state.value = 'done'
    progress.value = 100
    say(
      'ok',
      r.text
        ? T('ui.ocr.okRecognized', { conf: r.confidence })
        : T('ui.ocr.okRecognizedEmpty'),
    )
  } catch (e) {
    state.value = 'error'
    say('err', T('ui.ocr.errRecognizeLang', { msg: e.message || e }))
  } finally {
    busy.value = false
  }
}

async function runPdf() {
  if (!pdfFile.value) return say('err', T('ui.ocr.errSelectPdf'))
  busy.value = true
  state.value = 'working'
  progress.value = 0
  message.value = null
  pdfResults.value = []
  try {
    const r = await recognizePdf(pdfFile.value, {
      lang: lang.value,
      scale: Number(pdfScale.value) || 2,
      pages: pdfPages.value,
      onprogress: (p, page, total) => {
        progress.value = p
        progressLabel.value = T('ui.ocr.progressPage', { page, total })
      },
    })
    pdfResults.value = r.results
    pdfTotal.value = r.total
    state.value = 'done'
    progress.value = 100
    const empty = r.results.filter((x) => !x.text).length
    say(
      'ok',
      T('ui.ocr.okPdfDone', { total: r.total, done: r.results.length }) +
        (empty ? T('ui.ocr.okPdfEmpty', { n: empty }) : '') +
        T('ui.ocr.okPdfTail'),
    )
  } catch (e) {
    state.value = 'error'
    say('err', T('ui.ocr.errRecognize', { msg: e.message || e }))
  } finally {
    busy.value = false
  }
}

function pagesHint() {
  if (!pdfPages.value.trim() || !pdfTotal.value) return ''
  try {
    const arr = parsePages(pdfPages.value, pdfTotal.value || 999)
    return T('ui.ocr.pagesHint', {
      n: arr.length,
      pages: arr.slice(0, 12).join(', '),
      more: arr.length > 12 ? T('ui.ocr.pagesMore') : '',
    })
  } catch {
    return ''
  }
}

async function copyText() {
  const t = allText.value
  if (!t) return say('err', T('ui.ocr.errNoCopy'))
  try {
    await navigator.clipboard.writeText(t)
    say('ok', T('ui.ocr.okCopied'))
  } catch {
    say('err', T('ui.ocr.errClipboard'))
  }
}

function downloadTxt() {
  const t = allText.value
  if (!t) return say('err', T('ui.ocr.errNoExport'))
  const base = tab.value === 'image' ? basename(imgFile.value.name) : basename(pdfFile.value.name)
  downloadBlob(new Blob([t], { type: 'text/plain;charset=utf-8' }), `${base}-ocr.txt`)
  say('ok', T('ui.ocr.okExported'))
}

async function downloadZip() {
  if (tab.value !== 'pdf' || !pdfResults.value.length) return say('err', T('ui.ocr.errPdfOnly'))
  try {
    const parts = pdfResults.value.map((r) => ({
      blob: new Blob([r.text], { type: 'text/plain;charset=utf-8' }),
      name: `page-${String(r.page).padStart(3, '0')}.txt`,
    }))
    const zip = await createZip(parts, { level: 5 })
    downloadBlob(zip, `${basename(pdfFile.value.name)}-ocr.zip`)
    say('ok', T('ui.ocr.okZipped', { n: parts.length }))
  } catch (e) {
    say('err', T('ui.ocr.errZip', { msg: e.message || e }))
  }
}

// 跨工具工作流：识别出的文本 → 文本工具箱
function sendToText() {
  const text = allText.value
  if (!text) return say('err', T('ui.ocr.errNoSend'))
  stashText(text, '/ocr')
  router.push('/text')
}
</script>

<template>
  <h1 class="page-title">{{ T('ui.ocr.pageTitle') }}</h1>
  <p class="page-sub">
    {{ T('ui.ocr.sub1') }}
    <b style="color: var(--txt)">{{ T('ui.ocr.subBold') }}</b>。
  </p>

  <HelpTip :title="T('ui.ocr.helpTitle')" icon="bi-lightbulb" tone="tip" open>
    <ul>
      <li><b>{{ T('ui.ocr.help1Bold1') }}</b>{{ T('ui.ocr.help1a') }}<b>{{ T('ui.ocr.help1Bold2') }}</b>{{ T('ui.ocr.help1b') }}</li>
      <li><b>{{ T('ui.ocr.help2Bold') }}</b>{{ T('ui.ocr.help2Desc') }}</li>
      <li><b>{{ T('ui.ocr.help3Bold') }}</b>{{ T('ui.ocr.help3Desc') }}</li>
      <li><b>{{ T('ui.ocr.help4Bold') }}</b>{{ T('ui.ocr.help4Desc') }}</li>
      <li><b>{{ T('ui.ocr.help5Bold') }}</b>{{ T('ui.ocr.help5Desc') }}</li>
    </ul>
  </HelpTip>

  <StepBar :steps="steps" />

  <div class="tabs">
    <button :class="{ active: tab === 'image' }" @click="tab = 'image'">{{ T('ui.ocr.tabImage') }}</button>
    <button :class="{ active: tab === 'pdf' }" @click="tab = 'pdf'">{{ T('ui.ocr.tabPdf') }}</button>
  </div>

  <div class="panel">
    <div class="row wrap">
      <div class="field">
        <label>{{ T('ui.ocr.labelLang') }}</label>
        <select v-model="lang">
          <option v-for="l in OCR_LANGS" :key="l.id" :value="l.id">{{ langLabel(l) }}（{{ langSize(l) }}）</option>
        </select>
      </div>
      <div v-if="tab === 'pdf'" class="field">
        <label>{{ T('ui.ocr.labelPages') }}</label>
        <input v-model="pdfPages" type="text" :placeholder="T('ui.ocr.phPages')" style="width: 150px" />
      </div>
      <div v-if="tab === 'pdf'" class="field">
        <label>{{ T('ui.ocr.labelPdfScale', { n: pdfScale }) }}</label>
        <input v-model="pdfScale" type="range" min="1" max="4" step="0.5" style="width: 130px" />
      </div>
      <StatusPill
        :state="state"
        :label="state === 'working' ? T('ui.ocr.stWorking') : state === 'done' ? T('ui.ocr.stDone') : state === 'error' ? T('ui.ocr.stError') : T('ui.ocr.stIdle')"
      />
    </div>
    <p class="hint">
      {{ T('ui.ocr.labelCurrentLang') }}<b>{{ langLabel(currentLang) }}</b>{{ T('ui.ocr.hintLang1') }}<b>{{ langSize(currentLang) }}</b>{{ T('ui.ocr.hintLang2') }}
    </p>
    <p v-if="pagesHint()" class="hint">{{ pagesHint() }}</p>
  </div>

  <!-- 图片识别 -->
  <template v-if="tab === 'image'">
    <DropZone
      :multiple="false"
      accept="image/*"
      :single="T('ui.ocr.dropImageSingle')"
      formats="PNG / JPG / WEBP / BMP"
      :hint="T('ui.ocr.dropImageHint')"
      @files="onImageFiles"
    />
    <div v-if="imgFile" class="panel">
      <div v-if="imgPreview" class="img-preview"><img :src="imgPreview" :alt="imgFile.name" /></div>
      <div class="row wrap">
        <button class="btn" :disabled="busy" @click="runImage">
          <i class="bi bi-eye"></i> {{ busy ? T('ui.ocr.stRecognizing') : T('ui.ocr.btnStart') }}
        </button>
        <button v-if="hasText" class="btn ghost" @click="copyText"><i class="bi bi-clipboard"></i> {{ T('ui.ocr.btnCopyText') }}</button>
        <button v-if="hasText" class="btn ghost" @click="downloadTxt"><i class="bi bi-file-earmark-text"></i> {{ T('ui.ocr.btnExportTxt') }}</button>
        <button v-if="hasText" class="btn ghost" @click="sendToText"><i class="bi bi-code-slash"></i> {{ T('ui.ocr.btnSendToText') }}</button>
      </div>
      <div v-if="busy" class="progress"><span :style="{ width: progress + '%' }"></span></div>
      <div v-if="busy && progressLabel" class="hint">{{ progressLabel }} {{ progress }}%</div>
      <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
      <div v-if="imgResult" class="panel">
        <div class="status">
          {{ T('ui.ocr.resultHead1') }} <b style="color: var(--txt)">{{ imgResult.confidence }}</b> · {{ T('ui.ocr.resultSource') }}
          <b style="color: var(--txt)">{{ imgResult.source === 'local' ? T('ui.ocr.sourceLocal') : T('ui.ocr.sourceCdn') }}</b>
        </div>
        <pre class="ocr-out">{{ imgResult.text || T('ui.ocr.noText') }}</pre>
      </div>
    </div>
  </template>

  <!-- PDF 识别 -->
  <template v-else>
    <DropZone
      :multiple="false"
      accept=".pdf,application/pdf"
      single="PDF"
      formats="PDF"
      :hint="T('ui.ocr.dropPdfHint')"
      @files="onPdfFiles"
    />
    <div v-if="pdfFile" class="panel">
      <div class="row wrap">
        <button class="btn" :disabled="busy" @click="runPdf">
          <i class="bi bi-file-earmark-text"></i> {{ busy ? T('ui.ocr.stRecognizing') : T('ui.ocr.btnStart') }}
        </button>
        <button v-if="hasText" class="btn ghost" @click="copyText"><i class="bi bi-clipboard"></i> {{ T('ui.ocr.btnCopyAll') }}</button>
        <button v-if="hasText" class="btn ghost" @click="downloadTxt"><i class="bi bi-download"></i> {{ T('ui.ocr.btnMergeExportTxt') }}</button>
        <button v-if="hasText" class="btn ghost" @click="sendToText"><i class="bi bi-code-slash"></i> {{ T('ui.ocr.btnSendToText') }}</button>
        <button v-if="pdfResults.length > 1" class="btn ghost" @click="downloadZip">
          <i class="bi bi-file-earmark-zip"></i> {{ T('ui.ocr.btnZipPages') }}
        </button>
      </div>
      <div v-if="busy" class="progress"><span :style="{ width: progress + '%' }"></span></div>
      <div v-if="busy && progressLabel" class="hint">{{ progressLabel }} {{ progress }}%</div>
      <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
      <details v-for="r in pdfResults" :key="r.page" class="ocr-page" open>
        <summary>{{ T('ui.ocr.pageSummary', { page: r.page, conf: r.confidence, n: r.text.length }) }}</summary>
        <pre class="ocr-out">{{ r.text || T('ui.ocr.noTextPage') }}</pre>
      </details>
    </div>
  </template>
</template>

<style scoped>
.img-preview {
  max-height: 260px;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #0b1220;
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}
.img-preview img {
  max-width: 100%;
  max-height: 260px;
  object-fit: contain;
}
.ocr-out {
  margin: 10px 0 0;
  padding: 12px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(2, 8, 20, 0.6);
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--txt);
}
.ocr-page {
  margin-top: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.02);
}
.ocr-page summary {
  cursor: pointer;
  color: var(--txt-dim);
  font-size: 13px;
}
.ocr-page summary:hover {
  color: var(--txt);
}
</style>
