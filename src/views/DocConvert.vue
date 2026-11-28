<script setup>
// 文档转换（B-3）：Markdown → PDF / HTML。
// 自带零依赖 Markdown 解析器；PDF 渲染支持中日韩（canvas 位图通道）。
import { ref, computed } from 'vue'
import HelpTip from '../components/HelpTip.vue'
import PhaseProgress from '../components/PhaseProgress.vue'
import { parseMarkdown, markdownToPdf, markdownToHtml, hasWideChars } from '../lib/docconvert.js'
import { createProgress } from '../lib/progress.js'
import { downloadBlob } from '../utils.js'
import { pushToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'

const SAMPLE = `# LocalForge 文档转换

把 **Markdown** 转成 PDF 或 HTML，全程本地完成。

## 特性
- 支持标题、列表、引用、代码块
- 支持 *斜体*、**粗体**、\`行内代码\`
- 支持表格与链接

> 隐私优先：文件不上传任何服务器。

\`\`\`js
const forge = new LocalForge()
forge.convert('markdown', 'pdf')
\`\`\`

| 能力 | 状态 |
| --- | --- |
| 中文渲染 | 支持 |
| 表格 | 支持 |
`

const md = ref(SAMPLE)
const pageSize = ref('a4')
const busy = ref(false)
const previewHtml = ref('')
const useWide = computed(() => hasWideChars(md.value))
const blocks = computed(() => parseMarkdown(md.value))

const phase = createProgress([
  { id: 'parse', label: () => T('ui.doc.phaseParse'), weight: 1 },
  { id: 'render', label: () => T('ui.doc.phaseRender'), weight: 4 },
  { id: 'save', label: () => T('ui.doc.phaseSave'), weight: 1 },
])

function onFile(list) {
  const f = list[0]
  if (!f) return
  const r = new FileReader()
  r.onload = () => { md.value = String(r.result || '') }
  r.readAsText(f)
}

async function toPdf() {
  if (busy.value) return
  busy.value = true
  phase.reset()
  phase.set('parse', 1)
  try {
    const bytes = await markdownToPdf(md.value, {
      title: 'LocalForge Document',
      pageSize: pageSize.value,
      onProgress: (r) => phase.set('render', r),
    })
    phase.set('save', 1)
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'document.pdf')
    pushToast('ok', T('ui.doc.toastPdfOk'))
  } catch (e) {
    pushToast('err', T('ui.doc.toastPdfFail', { msg: e.message || e }))
  } finally {
    phase.finish()
    busy.value = false
  }
}

function toHtml() {
  const html = markdownToHtml(md.value, { title: 'LocalForge Document' })
  downloadBlob(new Blob([html], { type: 'text/html' }), 'document.html')
  pushToast('ok', T('ui.doc.toastHtmlOk'))
}

function preview() {
  previewHtml.value = markdownToHtml(md.value, { title: T('ui.doc.previewTitle') })
}
</script>

<template>
  <h1 class="page-title">{{ T('ui.doc.pageTitle') }}</h1>
  <p class="page-sub">{{ T('ui.doc.pageSub') }}</p>

  <HelpTip :title="T('ui.doc.stepTitle')" icon="bi-file-earmark-arrow-down" open tone="tip">
    <ol class="howto">
      <li v-html="T('ui.doc.step1')"></li>
      <li>{{ T('ui.doc.step2') }}</li>
      <li>{{ T('ui.doc.step3') }}</li>
    </ol>
  </HelpTip>

  <div class="panel">
    <div class="row wrap" style="margin-top:0">
      <span class="tag" :class="{ warn: useWide }">
        <i class="bi" :class="useWide ? 'bi-globe2' : 'bi-fonts'"></i>
        {{ useWide ? T('ui.doc.tagWide') : T('ui.doc.tagLatin') }}
      </span>
      <span class="tag"><i class="bi bi-blockquote-left"></i> {{ T('ui.doc.blocks', { n: blocks.length }) }}</span>
      <div class="field" style="margin-left:auto">
        <label>{{ T('ui.doc.paper') }}</label>
        <select v-model="pageSize">
          <option value="a4">A4</option>
          <option value="letter">Letter</option>
        </select>
      </div>
    </div>

    <label class="lbl">{{ T('ui.doc.mdContent') }}</label>
    <textarea v-model="md" class="md-input" spellcheck="false"></textarea>

    <input type="file" accept=".md,.markdown,.txt" class="sr-only" ref="fileInput" @change="onFile($event.target.files)" />
    <div class="row wrap">
      <button class="btn" :disabled="busy" @click="toPdf"><i class="bi bi-file-earmark-pdf"></i> {{ T('ui.doc.btnPdf') }}</button>
      <button class="btn ghost" @click="toHtml"><i class="bi bi-filetype-html"></i> {{ T('ui.doc.btnHtml') }}</button>
      <button class="btn ghost" @click="preview"><i class="bi bi-eye"></i> {{ T('ui.doc.btnPreview') }}</button>
      <button class="btn ghost" @click="$refs.fileInput.click()"><i class="bi bi-upload"></i> {{ T('ui.doc.btnLoad') }}</button>
    </div>

    <PhaseProgress v-if="busy" :progress="phase" />

    <iframe v-if="previewHtml" class="preview" :srcdoc="previewHtml" sandbox=""></iframe>
  </div>
</template>

<style scoped>
.lbl { display: block; font-size: 12.5px; color: var(--muted, #93a2bd); margin: 8px 0 6px; }
.md-input {
  width: 100%; min-height: 280px; resize: vertical; padding: 14px; border-radius: 10px;
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13.5px; line-height: 1.7;
  background: var(--panel-2, rgba(28,37,60,.55)); color: var(--txt, #e8edf7);
  border: 1px solid var(--line, rgba(120,150,200,.16));
}
.md-input:focus { outline: none; border-color: rgba(232,149,74,.5); }
.tag.warn { color: #fbbf24; border-color: rgba(251,191,36,.4); }
.preview { width: 100%; height: 420px; margin-top: 14px; border: 1px solid var(--line, rgba(120,150,200,.16)); border-radius: 10px; background: #fff; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
