<script setup>
// 公众号排版：Markdown → 微信兼容内联样式 HTML，并支持多端输出 / 模板 / 自定义主题 /
// 图片压缩 / 粘贴截图 / SVG→PNG / 元数据校对 / 报告导出 / 批量 / 草稿 / 离线发布包。
// 纯浏览器本地编译：不联网、不上传、不调用微信接口；产物只写入剪贴板 / 下载为文件。
// 渲染内核见 src/lib/wechat.js（零依赖纯函数）+ src/lib/wechat-extra.js（多端 / 数据能力）。
import { ref, computed, onMounted } from 'vue'
import HelpTip from '../components/HelpTip.vue'
import NextSteps from '../components/NextSteps.vue'
import { WECHAT_THEMES, WECHAT_SAMPLE, getTheme, parseDocument } from '../lib/wechat.js'
import {
  renderDocument, RENDER_TARGETS, targetLabel, targetHint,
  WECHAT_TEMPLATES, templateLabel,
  exportTheme, importTheme, checkMetadata,
  buildStoreZip, zipEntry, publishPackageFiles,
  describeIssue,
} from '../lib/wechat-extra.js'
import { downloadBlob } from '../utils.js'
import { pushToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'
import { locale } from '../lib/i18n.js'
import { consumePendingText, consumePending } from '../lib/workflow.js'

const md = ref(WECHAT_SAMPLE)
const theme = ref('ink')            // 主题 id（内置或自定义）
const target = ref('wechat')        // 输出平台
const templateId = ref('blank')     // 文章模板
const fontSize = ref(16)
const lineHeight = ref(1.75)
const smartSpace = ref(true)
const footnoteLinks = ref(true)
const macStyle = ref(true)
const images = ref({})
const previewOn = ref(true)
const fileInput = ref(null)
const imageInput = ref(null)
const themeInput = ref(null)
const batchInput = ref(null)
const customThemes = ref([])
const compressOn = ref(false)
const compressMaxEdge = ref(1200)
const compressQuality = ref(0.82)
const drafts = ref([])

const DRAFT_KEY = 'localforge.wechat.drafts'
const isWechat = computed(() => target.value === 'wechat')

// 主题对象（内置或自定义）；传对象给内核，getTheme 会先净化颜色
const themeValue = computed(() => {
  const c = customThemes.value.find((t) => t.id === theme.value)
  if (c) return c
  return WECHAT_THEMES.find((t) => t.id === theme.value) || WECHAT_THEMES[0]
})
const allThemes = computed(() => [...WECHAT_THEMES, ...customThemes.value])

// 统一多端渲染：wechat 走抗清洗内核，其余走通用语义渲染器
const result = computed(() => renderDocument(parseDocument(md.value), {
  target: target.value,
  options: {
    theme: themeValue.value,
    fontSize: fontSize.value,
    lineHeight: lineHeight.value,
    smartSpace: smartSpace.value,
    footnoteLinks: footnoteLinks.value,
    macStyle: macStyle.value,
    images: images.value,
  },
}))

const imageCount = computed(() => Object.keys(images.value).length)
// 诊断 code → 本地化文案（5 语言），errors/warnings 由内核派生，二者一致
const issues = computed(() => (result.value.report.issues || [])
  .map((i) => ({ level: i.level, text: describeIssue(i, locale.value) })))
const metadata = computed(() => checkMetadata(md.value))
const metaIssues = computed(() => (metadata.value.issues || [])
  .map((i) => ({ level: i.level, text: describeIssue(i, locale.value) })))
const targetNote = computed(() => targetHint(target.value, locale.value))

/* ---------------- 文件读取 / 图片处理 ---------------- */
function readAsText(file) { return file.text() }
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('FileReader failed'))
    r.readAsDataURL(file)
  })
}
function measure(url) {
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight })
    im.onerror = () => resolve({ w: 0, h: 0 })
    im.src = url
  })
}
// SVG → Canvas → PNG：微信会清洗 SVG defs/marker/id，纯本地先栅格化再内嵌
function svgToPng(url) {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => {
      const c = document.createElement('canvas')
      c.width = im.naturalWidth || 800
      c.height = im.naturalHeight || 600
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/png'))
    }
    im.onerror = () => reject(new Error('SVG decode failed'))
    im.src = url
  })
}
// Canvas 有损压缩：等比缩放 + 白底 JPEG，显著降低 DataURL 体积（纯本地、零依赖）
function compressDataUrl(url) {
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = () => {
      const scale = Math.min(1, compressMaxEdge.value / Math.max(im.naturalWidth, im.naturalHeight, 1))
      const w = Math.max(1, Math.round(im.naturalWidth * scale))
      const h = Math.max(1, Math.round(im.naturalHeight * scale))
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const cx = c.getContext('2d')
      cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, w, h) // 透明 → 白底，避免 JPEG 变黑
      cx.drawImage(im, 0, 0, w, h)
      resolve({ src: c.toDataURL('image/jpeg', compressQuality.value), w, h })
    }
    im.onerror = () => resolve({ src: url, w: 0, h: 0 })
    im.src = url
  })
}

async function addImageFile(f) {
  if (!/^image\//.test(f.type) && !/\.svg$/i.test(f.name)) return
  const raw = await readAsDataUrl(f)
  let entry, toastKey
  if (/\.svg$/i.test(f.name) || f.type === 'image/svg+xml') {
    entry = { src: await svgToPng(raw), w: 0, h: 0 }
    toastKey = 'views.wechatArticle.toastSvgConverted'
  } else if (compressOn.value) {
    entry = await compressDataUrl(raw)
    toastKey = 'views.wechatArticle.toastCompressed'
  } else {
    const { w, h } = await measure(raw)
    entry = { src: raw, w, h }
    toastKey = 'views.wechatArticle.toastImage'
  }
  const key = f.name.replace(/\.svg$/i, '.png')
  images.value = { ...images.value, [key]: entry }
  pushToast('ok', T(toastKey, { name: f.name }))
  return key
}

function onFile(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  readAsText(f).then((txt) => {
    md.value = txt
    pushToast('ok', T('views.wechatArticle.toastLoaded', { name: f.name }))
  })
  e.target.value = ''
}

async function onImages(e) {
  const list = Array.from((e.target && e.target.files) || [])
  for (const f of list) {
    try { await addImageFile(f) } catch (err) { pushToast('err', String(err.message || err)) }
  }
  if (e.target && 'value' in e.target) e.target.value = ''
}
function removeImage(name) {
  const next = { ...images.value }
  delete next[name]
  images.value = next
}

// 编辑区直接粘贴截图 → 本地化并插入 Markdown 引用
function onPaste(e) {
  const items = (e.clipboardData && e.clipboardData.items) || []
  for (const it of items) {
    if (!it.type || it.type.indexOf('image/') !== 0) continue
    const f = it.getAsFile()
    if (!f) continue
    e.preventDefault()
    const name = `pasted-${Date.now()}.png`
    readAsDataUrl(f).then(async (raw) => {
      let src = raw
      if (compressOn.value) src = (await compressDataUrl(raw)).src
      images.value = { ...images.value, [name]: { src, w: 0, h: 0 } }
      md.value += `\n![${name}](${name})\n`
      pushToast('ok', T('views.wechatArticle.toastPasted', { name }))
    })
    return
  }
}

/* ---------------- 富文本剪贴板 / 下载 ---------------- */
async function copyRich(html, plain) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    })])
    return
  }
  const ta = document.createElement('textarea')
  ta.value = plain
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  document.body.appendChild(ta)
  ta.focus(); ta.select()
  const handler = (ev) => {
    ev.preventDefault()
    ev.clipboardData.setData('text/html', html)
    ev.clipboardData.setData('text/plain', plain)
  }
  document.addEventListener('copy', handler, { once: true })
  let ok = false
  try { ok = document.execCommand('copy') } catch { /* 统一报错 */ }
  document.removeEventListener('copy', handler)
  ta.remove()
  if (!ok) throw new Error(T('views.wechatArticle.copyFallbackError'))
}
async function doCopy() {
  if (!result.value.report.ok) {
    pushToast('err', T('views.wechatArticle.toastErrors', { n: result.value.report.errors.length }))
    return
  }
  try {
    await copyRich(result.value.html, result.value.plain)
    pushToast('ok', T('views.wechatArticle.toastCopied'))
  } catch (e) {
    pushToast('err', T('views.wechatArticle.toastCopyFail', { msg: e.message || e }))
  }
}
function fullHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${result.value.title}</title></head><body style="max-width:677px;margin:24px auto;padding:0 16px">${result.value.html}</body></html>`
}
function doDownload() {
  downloadBlob(new Blob([fullHtml()], { type: 'text/html;charset=utf-8' }), 'wechat-article.html')
  pushToast('ok', T('views.wechatArticle.toastDownloaded'))
}
function loadSample() { md.value = WECHAT_SAMPLE; pushToast('ok', T('views.wechatArticle.toastSample')) }

/* ---------------- 模板 / 自定义主题 ---------------- */
function applyTemplate() {
  const tpl = WECHAT_TEMPLATES.find((t) => t.id === templateId.value)
  if (!tpl) return
  md.value = tpl.md
  pushToast('ok', T('views.wechatArticle.toastTemplate'))
}
async function importThemeFile(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  try {
    const res = importTheme(await readAsText(f))
    if (!res.ok || !res.theme) {
      pushToast('err', T('views.wechatArticle.toastThemeInvalid', { msg: describeIssue(res.issues[0], locale.value) }))
      return
    }
    customThemes.value = [...customThemes.value.filter((t) => t.id !== res.theme.id), res.theme]
    theme.value = res.theme.id
    pushToast('ok', T('views.wechatArticle.toastThemeImported'))
  } catch (err) {
    pushToast('err', T('views.wechatArticle.toastThemeInvalid', { msg: String(err.message || err) }))
  } finally { e.target.value = '' }
}
function exportThemeFile() {
  downloadBlob(new Blob([exportTheme(themeValue.value)], { type: 'application/json' }), `wechat-theme-${theme.value}.json`)
}

/* ---------------- 报告 / 离线发布包 / 批量 ---------------- */
function reportText() {
  const r = result.value.report
  const m = metadata.value
  return [
    `# ${T('views.wechatArticle.reportTitle')}`, '',
    `- target: ${target.value}`, `- title: ${result.value.title}`, `- ok: ${r.ok}`, '',
    `## errors`, ...(r.errors.length ? r.errors.map((x) => '- ' + x) : ['(none)']), '',
    `## warnings`, ...(r.warnings.length ? r.warnings.map((x) => '- ' + x) : ['(none)']), '',
    `## stats`, ...Object.entries(r.stats).map(([k, v]) => `- ${k}: ${v}`), '',
    `## metadata`, `- chars: ${m.chars}`, `- readMinutes: ${m.readMinutes}`,
    `- images: ${m.images}`, `- links: ${m.links}`,
    ...(metaIssues.value.map((i) => `- [${i.level}] ${i.text}`)), '',
    `Generated by LocalForge (offline, no network).`,
  ].join('\n')
}
function doReport() {
  downloadBlob(new Blob([reportText()], { type: 'text/markdown;charset=utf-8' }), 'wechat-report.md')
  pushToast('ok', T('views.wechatArticle.toastReport'))
}
function doPackage() {
  const files = publishPackageFiles({
    md: md.value, html: result.value.html, images: images.value,
    report: result.value.report, meta: result.value.meta,
    title: result.value.title, target: target.value,
  })
  downloadBlob(new Blob([buildStoreZip(files)], { type: 'application/zip' }), 'wechat-package.zip')
  pushToast('ok', T('views.wechatArticle.toastPackage'))
}
async function doBatch(e) {
  const list = Array.from((e.target && e.target.files) || [])
  const out = []
  for (const f of list) {
    if (!/\.(md|markdown|txt)$/i.test(f.name)) continue
    try {
      const text = await readAsText(f)
      const r = renderDocument(parseDocument(text), {
        target: target.value,
        options: { theme: themeValue.value, fontSize: fontSize.value, lineHeight: lineHeight.value, images: {} },
      })
      out.push(zipEntry(f.name.replace(/\.[^.]+$/, '') + '.html', fullHtmlFor(r)))
    } catch (err) { out.push(zipEntry(f.name + '.error.txt', String(err.message || err))) }
  }
  if (out.length) {
    downloadBlob(new Blob([buildStoreZip(out)], { type: 'application/zip' }), 'wechat-batch.zip')
    pushToast('ok', T('views.wechatArticle.toastBatch', { n: out.length }))
  }
  e.target.value = ''
}
function fullHtmlFor(r) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${r.title}</title></head><body style="max-width:677px;margin:24px auto;padding:0 16px">${r.html}</body></html>`
}

/* ---------------- 草稿历史（localStorage，纯本地） ---------------- */
function loadDrafts() {
  try { drafts.value = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]') } catch { drafts.value = [] }
}
function persistDrafts() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts.value)) } catch { /* 隐私模式下忽略 */ }
}
function saveDraft() {
  drafts.value = [{
    id: String(Date.now()), title: result.value.title, md: md.value,
    theme: theme.value, target: target.value, ts: Date.now(),
  }, ...drafts.value].slice(0, 10)
  persistDrafts()
  pushToast('ok', T('views.wechatArticle.toastDraftSaved'))
}
function restoreDraft(d) {
  md.value = d.md; theme.value = d.theme || 'ink'; target.value = d.target || 'wechat'
  pushToast('ok', T('views.wechatArticle.toastDraftRestored'))
}
function deleteDraft(id) {
  drafts.value = drafts.value.filter((d) => d.id !== id)
  persistDrafts()
}

/* ---------------- 站内工作流 ---------------- */
function collectResultFiles() {
  return [
    { name: 'article.html', blob: new Blob([fullHtml()], { type: 'text/html;charset=utf-8' }) },
    { name: 'article.md', blob: new Blob([md.value], { type: 'text/markdown;charset=utf-8' }) },
    { name: 'report.txt', blob: new Blob([reportText()], { type: 'text/plain;charset=utf-8' }) },
  ]
}
onMounted(() => {
  const t = consumePendingText()
  if (t && t.text) {
    md.value = t.text
    pushToast('ok', T('views.wechatArticle.toastLoaded', { name: t.from || 'text' }))
  }
  const p = consumePending()
  if (p && p.files && p.files.length) {
    let consumed = false
    for (const f of p.files) {
      if (/\.(md|markdown|txt)$/i.test(f.name) && !consumed) {
        readAsText(f).then((txt) => { md.value = txt })
        consumed = true
      } else if (/^image\//.test(f.type) || /\.svg$/i.test(f.name)) {
        addImageFile(f).catch(() => {})
      }
    }
  }
  loadDrafts()
})
</script>

<template>
  <h1 class="page-title">{{ T('views.wechatArticle.title') }}</h1>
  <p class="page-sub" v-html="T('views.wechatArticle.sub')"></p>

  <HelpTip :title="T('views.wechatArticle.helpTitle')" icon="bi-wechat" open tone="tip">
    <div v-html="T('views.wechatArticle.help')"></div>
  </HelpTip>

  <div class="panel">
    <div class="row wrap" style="margin-top:0">
      <div class="field">
        <label>{{ T('views.wechatArticle.themeLabel') }}</label>
        <select v-model="theme">
          <option v-for="t in allThemes" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </div>
      <div class="field">
        <label>{{ T('views.wechatArticle.targetLabel') }}</label>
        <select v-model="target">
          <option v-for="t in RENDER_TARGETS" :key="t.id" :value="t.id">{{ targetLabel(t.id, locale) }}</option>
        </select>
      </div>
      <div class="field">
        <label>{{ T('views.wechatArticle.templateLabel') }}</label>
        <select v-model="templateId">
          <option v-for="t in WECHAT_TEMPLATES" :key="t.id" :value="t.id">{{ templateLabel(t.id, locale) }}</option>
        </select>
      </div>
      <button class="btn ghost" @click="applyTemplate"><i class="bi bi-check2-square"></i> {{ T('views.wechatArticle.btnApplyTemplate') }}</button>
      <div class="field">
        <label>{{ T('views.wechatArticle.fontSizeLabel', { n: fontSize }) }}</label>
        <input type="range" min="14" max="20" step="1" v-model.number="fontSize" />
      </div>
      <div class="field">
        <label>{{ T('views.wechatArticle.lineHeightLabel', { n: lineHeight }) }}</label>
        <input type="range" min="1.5" max="2.1" step="0.05" v-model.number="lineHeight" />
      </div>
      <label class="chk"><input type="checkbox" v-model="smartSpace" /> {{ T('views.wechatArticle.smartSpace') }}</label>
      <label class="chk"><input type="checkbox" v-model="footnoteLinks" /> {{ T('views.wechatArticle.footnoteLinks') }}</label>
      <label class="chk"><input type="checkbox" v-model="macStyle" /> {{ T('views.wechatArticle.macStyle') }}</label>
      <span class="tag" :class="{ warn: !result.report.ok }">
        <i class="bi" :class="result.report.ok ? 'bi-shield-check' : 'bi-exclamation-triangle'"></i>
        {{ result.report.ok ? T('views.wechatArticle.selfOk') : T('views.wechatArticle.selfErrors', { n: result.report.errors.length }) }}
      </span>
      <span class="tag"><i class="bi bi-blockquote-left"></i> {{ T('views.wechatArticle.stats', { blocks: result.stats.blocks, images: result.stats.images, links: result.stats.links }) }}</span>
    </div>

    <div class="row wrap toolbar-sub">
      <span class="hint"><i class="bi bi-broadcast"></i> {{ targetNote }}</span>
      <span class="tag" v-if="!isWechat"><i class="bi bi-info-circle"></i> {{ T('views.wechatArticle.genericNote') }}</span>
    </div>

    <div class="row wrap toolbar-sub">
      <strong class="sec-label"><i class="bi bi-palette"></i> {{ T('views.wechatArticle.customThemeLabel') }}</strong>
      <button class="btn ghost" @click="$refs.themeInput.click()"><i class="bi bi-upload"></i> {{ T('views.wechatArticle.btnImportTheme') }}</button>
      <button class="btn ghost" @click="exportThemeFile"><i class="bi bi-download"></i> {{ T('views.wechatArticle.btnExportTheme') }}</button>
    </div>

    <div class="split">
      <div class="pane">
        <label class="lbl">{{ T('views.wechatArticle.mdLabel') }}</label>
        <textarea v-model="md" class="md-input" spellcheck="false" @paste="onPaste"></textarea>
        <p class="tiny-hint"><i class="bi bi-clipboard2-plus"></i> {{ T('views.wechatArticle.pasteHint') }}</p>
      </div>
      <div class="pane">
        <label class="lbl">{{ T('views.wechatArticle.previewLabel') }}</label>
        <iframe v-if="previewOn" class="preview" :srcdoc="result.previewHtml" sandbox=""></iframe>
      </div>
    </div>

    <div class="row wrap">
      <button class="btn" @click="doCopy"><i class="bi bi-clipboard-check"></i> {{ T('views.wechatArticle.btnCopy') }}</button>
      <button class="btn ghost" @click="doDownload"><i class="bi bi-filetype-html"></i> {{ T('views.wechatArticle.btnDownload') }}</button>
      <button class="btn ghost" @click="previewOn = !previewOn"><i class="bi bi-eye"></i> {{ previewOn ? T('views.wechatArticle.btnHidePreview') : T('views.wechatArticle.btnShowPreview') }}</button>
      <button class="btn ghost" @click="$refs.fileInput.click()"><i class="bi bi-upload"></i> {{ T('views.wechatArticle.btnLoadMd') }}</button>
      <button class="btn ghost" @click="loadSample"><i class="bi bi-magic"></i> {{ T('views.wechatArticle.btnSample') }}</button>
      <button class="btn ghost" @click="$refs.imageInput.click()"><i class="bi bi-image"></i> {{ T('views.wechatArticle.btnAddImages') }}</button>
      <button class="btn ghost" @click="doReport"><i class="bi bi-file-earmark-text"></i> {{ T('views.wechatArticle.btnReport') }}</button>
      <button class="btn ghost" @click="doPackage"><i class="bi bi-box-seam"></i> {{ T('views.wechatArticle.btnPackage') }}</button>
      <button class="btn ghost" @click="$refs.batchInput.click()"><i class="bi bi-collection"></i> {{ T('views.wechatArticle.btnBatch') }}</button>
      <button class="btn ghost" @click="saveDraft"><i class="bi bi-save"></i> {{ T('views.wechatArticle.btnSaveDraft') }}</button>
    </div>

    <input type="file" accept=".md,.markdown,.txt" class="sr-only" ref="fileInput" @change="onFile" />
    <input type="file" accept="image/*,.svg" multiple class="sr-only" ref="imageInput" @change="onImages" />
    <input type="file" accept=".json,application/json" class="sr-only" ref="themeInput" @change="importThemeFile" />
    <input type="file" accept=".md,.markdown,.txt" multiple class="sr-only" ref="batchInput" @change="doBatch" />

    <div class="assets" @dragover.prevent @drop.prevent="onImages({ target: { files: $event.dataTransfer.files } })">
      <div class="assets-head">
        <strong>{{ T('views.wechatArticle.assetsTitle') }}</strong>
        <span class="hint">{{ T('views.wechatArticle.assetsHint') }}</span>
        <span class="tag">{{ T('views.wechatArticle.assetsCount', { n: imageCount }) }}</span>
      </div>
      <label class="chk"><input type="checkbox" v-model="compressOn" /> {{ T('views.wechatArticle.compressImages') }}</label>
      <span class="hint" v-if="compressOn"> ≤ {{ compressMaxEdge }}px · {{ Math.round(compressQuality * 100) }}% </span>
      <div v-if="imageCount" class="chips">
        <span v-for="(v, k) in images" :key="k" class="chip">
          <i class="bi bi-image"></i> {{ k }} <small>{{ v.w || '?' }}×{{ v.h || '?' }}</small>
          <button class="chip-x" @click="removeImage(k)" title="remove"><i class="bi bi-x"></i></button>
        </span>
      </div>
      <p v-else class="hint" style="margin:6px 0 0">{{ T('views.wechatArticle.assetsEmpty') }}</p>
    </div>

    <div class="report">
      <div class="assets-head">
        <strong><i class="bi bi-card-checklist"></i> {{ T('views.wechatArticle.metaTitleLabel') }} · {{ T('views.wechatArticle.metaOk') }}</strong>
      </div>
      <div class="meta-grid">
        <span class="tag">{{ T('views.wechatArticle.metaChars', { n: metadata.chars }) }}</span>
        <span class="tag">{{ T('views.wechatArticle.metaRead', { n: metadata.readMinutes }) }}</span>
        <span class="tag">{{ T('views.wechatArticle.metaImages', { n: metadata.images }) }}</span>
        <span class="tag">{{ T('views.wechatArticle.metaLinks', { n: metadata.links }) }}</span>
        <span class="meta-title">{{ T('views.wechatArticle.metaTitleLabel') }}：{{ metadata.title || '—' }}</span>
        <span class="meta-title">{{ T('views.wechatArticle.metaDigestLabel') }}：{{ metadata.digest || '—' }}</span>
      </div>
      <ul v-if="metaIssues.length" class="issue-list">
        <li v-for="(i, n) in metaIssues" :key="n" :class="i.level"><i class="bi" :class="i.level === 'error' ? 'bi-x-circle' : 'bi-exclamation-circle'"></i> {{ i.text }}</li>
      </ul>
    </div>

    <div class="report">
      <div class="assets-head">
        <strong>{{ T('views.wechatArticle.draftLabel') }}</strong>
        <span class="hint">localStorage</span>
      </div>
      <p v-if="!drafts.length" class="hint" style="margin:6px 0 0">{{ T('views.wechatArticle.draftEmpty') }}</p>
      <div v-else class="draft-list">
        <div v-for="d in drafts" :key="d.id" class="draft-row">
          <i class="bi bi-file-earmark-text"></i>
          <span class="draft-name">{{ d.title || '(untitled)' }}</span>
          <button class="btn ghost mini" @click="restoreDraft(d)">{{ T('views.wechatArticle.btnRestoreDraft') }}</button>
          <button class="btn ghost mini" @click="deleteDraft(d.id)">{{ T('views.wechatArticle.btnDeleteDraft') }}</button>
        </div>
      </div>
    </div>

    <div class="report">
      <div class="assets-head">
        <strong>{{ T('views.wechatArticle.reportTitle') }}</strong>
        <span class="hint">{{ T('views.wechatArticle.reportStats', { styles: result.report.stats.inlineStyles, leaf: result.report.stats.leafNodes, depth: result.report.stats.maxDepth }) }}</span>
      </div>
      <p v-if="!issues.length" class="ok-line"><i class="bi bi-check-circle"></i> {{ T('views.wechatArticle.reportOk') }}</p>
      <ul v-else class="issue-list">
        <li v-for="(i, n) in issues" :key="n" :class="i.level"><i class="bi" :class="i.level === 'error' ? 'bi-x-circle' : 'bi-exclamation-circle'"></i> {{ i.text }}</li>
      </ul>
    </div>

    <NextSteps from="/wechat-article" :get-files="collectResultFiles" :title="T('views.wechatArticle.nextTitle')" />
  </div>
</template>

<style scoped>
.lbl { display: block; font-size: 12.5px; color: var(--muted, #93a2bd); margin: 8px 0 6px; }
.md-input {
  width: 100%; min-height: 420px; resize: vertical; padding: 14px; border-radius: 10px;
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; line-height: 1.7;
  background: var(--panel-2, rgba(28,37,60,.55)); color: var(--txt, #e8edf7);
  border: 1px solid var(--line, rgba(120,150,200,.16));
}
.md-input:focus { outline: none; border-color: rgba(56,189,248,.5); }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 12px 0; }
.pane { min-width: 0; }
.preview { width: 100%; height: 460px; border: 1px solid var(--line, rgba(120,150,200,.16)); border-radius: 10px; background: #fff; }
.chk { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--muted, #93a2bd); }
.chk input { accent-color: #38bdf8; }
.field input[type=range] { width: 110px; vertical-align: middle; }
.tag.warn { color: #fbbf24; border-color: rgba(251,191,36,.4); }
.toolbar-sub { margin-top: 8px; gap: 10px; }
.sec-label { font-size: 12.5px; color: var(--muted, #93a2bd); font-weight: 600; }
.assets, .report { margin-top: 16px; padding: 14px; border: 1px dashed var(--line, rgba(120,150,200,.28)); border-radius: 10px; }
.assets-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.assets-head small { color: var(--muted, #93a2bd); font-weight: 400; }
.hint { color: var(--muted, #93a2bd); font-size: 12px; }
.tiny-hint { color: var(--muted, #93a2bd); font-size: 11.5px; margin: 6px 0 0; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 20px; background: var(--panel-2, rgba(28,37,60,.55)); font-size: 12px; }
.chip small { color: var(--muted, #93a2bd); }
.chip-x { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 2px; }
.meta-grid { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
.meta-title { font-size: 12px; color: var(--muted, #93a2bd); }
.draft-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.draft-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.draft-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn.mini { padding: 2px 8px; font-size: 11.5px; }
.issue-list { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; }
.issue-list li { margin: 4px 0; }
.issue-list li.error { color: #f87171; }
.issue-list li.warning { color: #fbbf24; }
.ok-line { color: #4ade80; font-size: 12.5px; margin: 8px 0 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 900px) { .split { grid-template-columns: 1fr; } .preview { height: 380px; } }
</style>
