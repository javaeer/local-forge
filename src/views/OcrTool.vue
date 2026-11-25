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
    title: tab.value === 'image' ? '放入图片' : '放入 PDF',
    desc: tab.value === 'image' ? '截图、照片或扫描件' : '扫描版 PDF / 图片型 PDF',
    state: (tab.value === 'image' ? imgFile.value : pdfFile.value) ? 'done' : 'todo',
  },
  { title: '选择识别语言', desc: '首次使用需下载该语言包', state: lang.value ? 'done' : 'todo' },
  {
    title: '开始识别',
    desc: '本地内核 + 缓存语言包',
    state: state.value === 'working' ? 'working' : state.value === 'done' ? 'done' : state.value === 'error' ? 'error' : 'todo',
  },
])

const currentLang = computed(() => OCR_LANGS.find((l) => l.id === lang.value))
const hasText = computed(() =>
  tab.value === 'image' ? !!(imgResult.value && imgResult.value.text) : pdfResults.value.some((r) => r.text),
)
const allText = computed(() => {
  if (tab.value === 'image') return imgResult.value ? imgResult.value.text : ''
  return pdfResults.value.map((r) => `===== 第 ${r.page} 页 =====\n${r.text}`).join('\n\n')
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
      p.stage === 'lang' ? `正在下载语言包（${currentLang.value ? currentLang.value.label : lang.value}）…` : `正在识别…`
  })
  // 跨工具工作流：接收上一步传来的图片/PDF
  const pending = consumePending()
  if (pending && pending.files.length) {
    const f = pending.files[0]
    if (/^image\//.test(f.type)) { tab.value = 'image'; onImageFiles([f]) }
    else if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') { tab.value = 'pdf'; onPdfFiles([f]) }
    pushToast('info', `已从「${pending.from}」载入 1 个文件`)
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
    return say('err', '这不是图片文件：' + f.name + '（请放入 PNG / JPG / WEBP 等图片）')
  }
  imgFile.value = f
  imgResult.value = null
  message.value = null
  state.value = 'idle'
  if (imgPreview.value) URL.revokeObjectURL(imgPreview.value)
  imgPreview.value = URL.createObjectURL(f)
  say('info', `已载入 ${f.name}（${formatSize(f.size)}）。选择识别语言后点「开始识别」。`)
}

async function onPdfFiles(files) {
  const f = files && files[0]
  if (!f) return
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
    state.value = 'error'
    return say('err', '这不是 PDF 文件：' + f.name)
  }
  pdfFile.value = f
  pdfResults.value = []
  message.value = null
  state.value = 'idle'
  say('info', `已载入 ${f.name}（${formatSize(f.size)}）。可指定页码范围，留空则识别全部页。`)
}

async function runImage() {
  if (!imgFile.value) return say('err', '请先放入一张图片')
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
        ? `识别完成（置信度 ${r.confidence}）。可直接复制，或导出为 TXT。`
        : '识别完成，但没读到文字。可能是图片太模糊、字号过小或纯图形，试试放大原图或换「简体中文 + 英语」。',
    )
  } catch (e) {
    state.value = 'error'
    say('err', '识别失败：' + (e.message || e) + '（常见原因：首次语言包下载失败，请检查网络后重试）')
  } finally {
    busy.value = false
  }
}

async function runPdf() {
  if (!pdfFile.value) return say('err', '请先放入一个 PDF')
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
        progressLabel.value = `正在识别第 ${page} / ${total} 页…`
      },
    })
    pdfResults.value = r.results
    pdfTotal.value = r.total
    state.value = 'done'
    progress.value = 100
    const empty = r.results.filter((x) => !x.text).length
    say(
      'ok',
      `完成：共 ${r.total} 页，已识别 ${r.results.length} 页` +
        (empty ? `（其中 ${empty} 页未读到文字，可能是空白页或清晰度不足）` : '') +
        '。可导出 TXT，或打包为 ZIP。',
    )
  } catch (e) {
    state.value = 'error'
    say('err', '识别失败：' + (e.message || e))
  } finally {
    busy.value = false
  }
}

function pagesHint() {
  if (!pdfPages.value.trim() || !pdfTotal.value) return ''
  try {
    const arr = parsePages(pdfPages.value, pdfTotal.value || 999)
    return `将识别 ${arr.length} 页：${arr.slice(0, 12).join(', ')}${arr.length > 12 ? '…' : ''}`
  } catch {
    return ''
  }
}

async function copyText() {
  const t = allText.value
  if (!t) return say('err', '还没有可复制的识别结果')
  try {
    await navigator.clipboard.writeText(t)
    say('ok', '已复制到剪贴板')
  } catch {
    say('err', '浏览器拒绝了剪贴板访问，请手动选中文本复制')
  }
}

function downloadTxt() {
  const t = allText.value
  if (!t) return say('err', '还没有可导出的识别结果')
  const base = tab.value === 'image' ? basename(imgFile.value.name) : basename(pdfFile.value.name)
  downloadBlob(new Blob([t], { type: 'text/plain;charset=utf-8' }), `${base}-ocr.txt`)
  say('ok', '已导出 TXT')
}

async function downloadZip() {
  if (tab.value !== 'pdf' || !pdfResults.value.length) return say('err', 'PDF 模式下才有逐页结果可打包')
  try {
    const parts = pdfResults.value.map((r) => ({
      blob: new Blob([r.text], { type: 'text/plain;charset=utf-8' }),
      name: `page-${String(r.page).padStart(3, '0')}.txt`,
    }))
    const zip = await createZip(parts, { level: 5 })
    downloadBlob(zip, `${basename(pdfFile.value.name)}-ocr.zip`)
    say('ok', `已打包 ${parts.length} 个 TXT 为 ZIP`)
  } catch (e) {
    say('err', '打包失败：' + (e.message || e))
  }
}

// 跨工具工作流：识别出的文本 → 文本工具箱
function sendToText() {
  const text = allText.value
  if (!text) return say('err', '还没有可送出的识别结果')
  stashText(text, '/ocr')
  router.push('/text')
}
</script>

<template>
  <h1 class="page-title">OCR 文字识别</h1>
  <p class="page-sub">
    把截图、照片、扫描件或扫描版 PDF 转成可编辑文字 ——
    <b style="color: var(--txt)">识别全程在本地浏览器完成，图片与 PDF 从不上传任何服务器</b>。
  </p>

  <HelpTip title="这个功能怎么用？先看这里" icon="bi-lightbulb" tone="tip" open>
    <ul>
      <li><b>识别内核已随程序本地打包</b>，离线也能跑；只有<b>语言包</b>需要首次使用时下载一次（之后浏览器会自动缓存）。</li>
      <li><b>语言怎么选</b>：中文材料选「简体中文 + 英语」最稳；纯英文材料选「英语」，体积更小、速度更快。</li>
      <li><b>识别率取决于原图质量</b>：文字越大越清晰越准。截图/扫描件建议 300dpi 以上；手机拍照尽量正对、避免反光和倾斜。</li>
      <li><b>扫描版 PDF</b>（本质是图片）用「PDF 识别」；如果 PDF 本身可选中文字，直接复制即可，无需 OCR。</li>
      <li><b>页数多时请耐心</b>：OCR 是 CPU 密集型任务，每页通常几秒，界面会实时显示进度。</li>
    </ul>
  </HelpTip>

  <StepBar :steps="steps" />

  <div class="tabs">
    <button :class="{ active: tab === 'image' }" @click="tab = 'image'">图片识别</button>
    <button :class="{ active: tab === 'pdf' }" @click="tab = 'pdf'">PDF 逐页识别</button>
  </div>

  <div class="panel">
    <div class="row wrap">
      <div class="field">
        <label>识别语言</label>
        <select v-model="lang">
          <option v-for="l in OCR_LANGS" :key="l.id" :value="l.id">{{ l.label }}（{{ l.size }}）</option>
        </select>
      </div>
      <div v-if="tab === 'pdf'" class="field">
        <label>页码范围（留空=全部）</label>
        <input v-model="pdfPages" type="text" placeholder="例如 1-3,5,8-" style="width: 150px" />
      </div>
      <div v-if="tab === 'pdf'" class="field">
        <label>渲染倍率 {{ pdfScale }}x</label>
        <input v-model="pdfScale" type="range" min="1" max="4" step="0.5" style="width: 130px" />
      </div>
      <StatusPill
        :state="state"
        :label="state === 'working' ? '识别中' : state === 'done' ? '已完成' : state === 'error' ? '出错' : '待开始'"
      />
    </div>
    <p class="hint">
      当前语言：<b>{{ currentLang.label }}</b> · 首次使用需下载约 <b>{{ currentLang.size }}</b> 的语言包，之后自动缓存、离线可用。
    </p>
    <p v-if="pagesHint()" class="hint">{{ pagesHint() }}</p>
  </div>

  <!-- 图片识别 -->
  <template v-if="tab === 'image'">
    <DropZone
      :multiple="false"
      accept="image/*"
      single="图片"
      formats="PNG / JPG / WEBP / BMP"
      hint="拖放截图、照片或扫描件到此处"
      @files="onImageFiles"
    />
    <div v-if="imgFile" class="panel">
      <div v-if="imgPreview" class="img-preview"><img :src="imgPreview" :alt="imgFile.name" /></div>
      <div class="row wrap">
        <button class="btn" :disabled="busy" @click="runImage">
          <i class="bi bi-eye"></i> {{ busy ? '识别中…' : '开始识别' }}
        </button>
        <button v-if="hasText" class="btn ghost" @click="copyText"><i class="bi bi-clipboard"></i> 复制文字</button>
        <button v-if="hasText" class="btn ghost" @click="downloadTxt"><i class="bi bi-file-earmark-text"></i> 导出 TXT</button>
        <button v-if="hasText" class="btn ghost" @click="sendToText"><i class="bi bi-code-slash"></i> 送去文本工具</button>
      </div>
      <div v-if="busy" class="progress"><span :style="{ width: progress + '%' }"></span></div>
      <div v-if="busy && progressLabel" class="hint">{{ progressLabel }} {{ progress }}%</div>
      <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
      <div v-if="imgResult" class="panel">
        <div class="status">
          识别结果 · 置信度 <b style="color: var(--txt)">{{ imgResult.confidence }}</b> · 内核来源
          <b style="color: var(--txt)">{{ imgResult.source === 'local' ? '本地' : 'CDN 回退' }}</b>
        </div>
        <pre class="ocr-out">{{ imgResult.text || '（未识别到文字）' }}</pre>
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
      hint="拖放扫描版 PDF 到此处"
      @files="onPdfFiles"
    />
    <div v-if="pdfFile" class="panel">
      <div class="row wrap">
        <button class="btn" :disabled="busy" @click="runPdf">
          <i class="bi bi-file-earmark-text"></i> {{ busy ? '识别中…' : '开始识别' }}
        </button>
        <button v-if="hasText" class="btn ghost" @click="copyText"><i class="bi bi-clipboard"></i> 复制全部</button>
        <button v-if="hasText" class="btn ghost" @click="downloadTxt"><i class="bi bi-download"></i> 合并导出 TXT</button>
        <button v-if="hasText" class="btn ghost" @click="sendToText"><i class="bi bi-code-slash"></i> 送去文本工具</button>
        <button v-if="pdfResults.length > 1" class="btn ghost" @click="downloadZip">
          <i class="bi bi-file-earmark-zip"></i> 逐页打包 ZIP
        </button>
      </div>
      <div v-if="busy" class="progress"><span :style="{ width: progress + '%' }"></span></div>
      <div v-if="busy && progressLabel" class="hint">{{ progressLabel }} {{ progress }}%</div>
      <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
      <details v-for="r in pdfResults" :key="r.page" class="ocr-page" open>
        <summary>第 {{ r.page }} 页 · 置信度 {{ r.confidence }} · {{ r.text.length }} 字</summary>
        <pre class="ocr-out">{{ r.text || '（本页未识别到文字）' }}</pre>
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
