<script setup>
// 公众号排版：Markdown → 微信兼容内联样式 HTML。
// 纯浏览器本地编译：不联网、不上传、不调用微信接口；产物只写入剪贴板 / 下载为 HTML。
// 渲染内核见 src/lib/wechat.js（零依赖纯函数，可独立单测）。
import { ref, computed } from 'vue'
import HelpTip from '../components/HelpTip.vue'
import { WECHAT_THEMES, WECHAT_SAMPLE, renderWechatArticle } from '../lib/wechat.js'
import { downloadBlob } from '../utils.js'
import { pushToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'

const md = ref(WECHAT_SAMPLE)
const theme = ref('ink')
const fontSize = ref(16)
const lineHeight = ref(1.75)
const smartSpace = ref(true)
const footnoteLinks = ref(true)
const macStyle = ref(true)
const images = ref({})
const previewOn = ref(true)
const fileInput = ref(null)
const imageInput = ref(null)

const result = computed(() => renderWechatArticle(md.value, {
  theme: theme.value,
  fontSize: fontSize.value,
  lineHeight: lineHeight.value,
  smartSpace: smartSpace.value,
  footnoteLinks: footnoteLinks.value,
  macStyle: macStyle.value,
  images: images.value,
}))

const imageCount = computed(() => Object.keys(images.value).length)
const issues = computed(() => [
  ...result.value.report.errors.map((text) => ({ level: 'error', text })),
  ...result.value.report.warnings.map((text) => ({ level: 'warning', text })),
])

function onFile(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  const r = new FileReader()
  r.onload = () => { md.value = String(r.result || ''); pushToast('ok', T('views.wechatArticle.toastLoaded', { name: f.name })) }
  r.readAsText(f)
  e.target.value = ''
}

// 本地图片 → DataURL（记录原始尺寸供 data-w 使用）。所有字节只留在浏览器内存里。
function onImages(e) {
  const files = Array.from(e.target.files || [])
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue
    const r = new FileReader()
    r.onload = () => {
      const src = String(r.result || '')
      const im = new Image()
      const save = (w, h) => {
        images.value = { ...images.value, [f.name]: { src, w, h } }
        pushToast('ok', T('views.wechatArticle.toastImage', { name: f.name }))
      }
      im.onload = () => save(im.naturalWidth, im.naturalHeight)
      im.onerror = () => save(0, 0)
      im.src = src
    }
    r.readAsDataURL(f)
  }
  e.target.value = ''
}
function removeImage(name) {
  const next = { ...images.value }
  delete next[name]
  images.value = next
}

// 富文本剪贴板：必须同时写 text/html 与 text/plain，否则会粘出 HTML 源码。
// Clipboard API 只有 Chrome/Edge 完整支持，故保留 copy 事件回退路径。
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
  try { ok = document.execCommand('copy') } catch { /* 忽略，下面统一报错 */ }
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

function doDownload() {
  const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${result.value.title}</title></head><body style="max-width:677px;margin:24px auto;padding:0 16px">${result.value.html}</body></html>`
  downloadBlob(new Blob([doc], { type: 'text/html;charset=utf-8' }), 'wechat-article.html')
  pushToast('ok', T('views.wechatArticle.toastDownloaded'))
}
function loadSample() { md.value = WECHAT_SAMPLE; pushToast('ok', T('views.wechatArticle.toastSample')) }
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
          <option v-for="t in WECHAT_THEMES" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </div>
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

    <div class="split">
      <div class="pane">
        <label class="lbl">{{ T('views.wechatArticle.mdLabel') }}</label>
        <textarea v-model="md" class="md-input" spellcheck="false"></textarea>
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
    </div>

    <input type="file" accept=".md,.markdown,.txt" class="sr-only" ref="fileInput" @change="onFile" />
    <input type="file" accept="image/*" multiple class="sr-only" ref="imageInput" @change="onImages" />

    <div class="assets" @dragover.prevent @drop.prevent="onImages({ target: { files: $event.dataTransfer.files } })">
      <div class="assets-head">
        <strong>{{ T('views.wechatArticle.assetsTitle') }}</strong>
        <span class="hint">{{ T('views.wechatArticle.assetsHint') }}</span>
        <span class="tag">{{ T('views.wechatArticle.assetsCount', { n: imageCount }) }}</span>
      </div>
      <div v-if="imageCount" class="chips">
        <span v-for="(v, k) in images" :key="k" class="chip">
          <i class="bi bi-image"></i> {{ k }} <small>{{ v.w || '?' }}×{{ v.h || '?' }}</small>
          <button class="chip-x" @click="removeImage(k)" title="移除"><i class="bi bi-x"></i></button>
        </span>
      </div>
      <p v-else class="hint" style="margin:6px 0 0">{{ T('views.wechatArticle.assetsEmpty') }}</p>
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
.assets, .report { margin-top: 16px; padding: 14px; border: 1px dashed var(--line, rgba(120,150,200,.28)); border-radius: 10px; }
.assets-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.assets-head small { color: var(--muted, #93a2bd); font-weight: 400; }
.hint { color: var(--muted, #93a2bd); font-size: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 20px; background: var(--panel-2, rgba(28,37,60,.55)); font-size: 12px; }
.chip small { color: var(--muted, #93a2bd); }
.chip-x { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 2px; }
.issue-list { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; }
.issue-list li { margin: 4px 0; }
.issue-list li.error { color: #f87171; }
.issue-list li.warning { color: #fbbf24; }
.ok-line { color: #4ade80; font-size: 12.5px; margin: 8px 0 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 900px) { .split { grid-template-columns: 1fr; } .preview { height: 380px; } }
</style>
