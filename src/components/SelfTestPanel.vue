<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { createApp } from 'vue'
import router from '../router'
import { runAllSelfTests } from '../lib/selftest.js'

// ---------- 全局运行期错误捕获（任何 bug 都不漏）----------
const runtimeErrors = ref([])
let origConsoleError = null
function pushErr(e) {
  runtimeErrors.value.push(e)
}
function onWindowError(e) {
  pushErr({ type: 'error', message: e.message || String(e), stack: e.error && e.error.stack ? e.error.stack : '' })
}
function onUnhandledRejection(e) {
  const r = e.reason
  pushErr({ type: 'unhandledrejection', message: r && r.message ? r.message : String(r), stack: r && r.stack ? r.stack : '' })
}
onMounted(() => {
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  origConsoleError = console.error
  console.error = (...args) => {
    pushErr({ type: 'console.error', message: args.map((a) => (a && a.stack) ? a.stack : (a instanceof Error ? a.message : String(a))).join(' ') })
    origConsoleError.apply(console, args)
  }
})
onUnmounted(() => {
  window.removeEventListener('error', onWindowError)
  window.removeEventListener('unhandledrejection', onUnhandledRejection)
  if (origConsoleError) console.error = origConsoleError
})

// ---------- 引擎自检 ----------
const loading = ref(false)
const report = ref(null)
async function runEngine() {
  loading.value = true
  runtimeErrors.value = [] // 本次运行开始，清空运行期错误以便对应
  try {
    report.value = await runAllSelfTests()
  } catch (e) {
    pushErr({ type: 'engine-run', message: e.message, stack: e.stack })
  } finally {
    loading.value = false
  }
}

const total = computed(() => (report.value ? report.value.modules.reduce((s, m) => s + (m.items ? m.items.length : 0), 0) : 0))
const passed = computed(() => (report.value ? report.value.modules.reduce((s, m) => s + (m.items ? m.items.filter((i) => i.ok && !i.skipped).length : 0), 0) : 0))
const failed = computed(() => (report.value ? report.value.modules.reduce((s, m) => s + (m.items ? m.items.filter((i) => !i.ok).length : 0), 0) : 0))
const skipped = computed(() => (report.value ? report.value.modules.reduce((s, m) => s + (m.items ? m.items.filter((i) => i.skipped).length : 0), 0) : 0))

// ---------- 视图渲染自检（逐路由隔离挂载，捕获渲染期错误）----------
const viewLoading = ref(false)
const viewResults = ref([])
// 静态分析友好的方式：用 import.meta.glob 预生成视图模块映射，避免动态字符串导入警告
const viewModules = import.meta.glob('../views/*.vue')
const VIEW_ROUTES = [
  { path: '/zip-compress', file: 'ZipCompress.vue' },
  { path: '/zip-extract', file: 'ZipExtract.vue' },
  { path: '/archive', file: 'ArchiveTool.vue' },
  { path: '/media-convert', file: 'MediaConvert.vue' },
  { path: '/media-pro', file: 'MediaPro.vue' },
  { path: '/image-convert', file: 'ImageConvert.vue' },
  { path: '/pdf-tools', file: 'PdfTools.vue' },
  { path: '/pdf-pro', file: 'PdfPro.vue' },
  { path: '/share-files', file: 'ShareFiles.vue' },
  { path: '/password-recovery', file: 'PasswordRecovery.vue' },
  { path: '/repair', file: 'Repair.vue' },
  { path: '/qr-code', file: 'QrCode.vue' },
  { path: '/hash', file: 'HashTool.vue' },
  { path: '/exif', file: 'ExifTool.vue' },
  { path: '/text', file: 'TextTool.vue' },
  { path: '/ocr', file: 'OcrTool.vue' },
  // 本次合并进来的新视图，须与 router 的 NAV / fileToPath 保持同步
  { path: '/svg-tool', file: 'SvgTool.vue' },
  { path: '/css-reference', file: 'CssReference.vue' },
]
async function runViewSmoke() {
  viewLoading.value = true
  runtimeErrors.value = []
  viewResults.value = []
  for (const r of VIEW_ROUTES) {
    let captured = null
    try {
      const loader = viewModules[`../views/${r.file}`]
      if (!loader) {
        captured = new Error(`未在 glob 中找到视图模块：../views/${r.file}`)
        viewResults.value.push({ path: r.path, ok: false, error: { message: captured.message, stack: '' } })
        continue
      }
      const mod = await loader()
      const Comp = mod.default
      const Root = {
        components: { Comp },
        errorCaptured: (err) => { captured = err; return false },
        template: '<Comp />',
      }
      const app = createApp(Root)
      app.use(router)
      app.config.errorHandler = (err) => { captured = err }
      const host = document.createElement('div')
      await new Promise((resolve) => {
        app.mount(host)
        // 等两拍，捕获同步渲染错误 + onMounted 内的同步抛错
        setTimeout(() => { try { app.unmount() } catch { /* ignore */ } resolve() }, 120)
      })
    } catch (e) {
      captured = e
    }
    viewResults.value.push({
      path: r.path,
      ok: !captured,
      error: captured ? { message: captured.message, stack: captured.stack } : null,
    })
  }
  viewLoading.value = false
}

// ---------- 复制报告 ----------
async function copyReport() {
  const payload = {
    generatedAt: report.value ? report.value.generatedAt : null,
    engine: report.value,
    runtimeErrors: runtimeErrors.value,
    viewResults: viewResults.value,
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
  } catch {
    /* 剪贴板不可用时忽略 */
  }
}
function clearErrors() {
  runtimeErrors.value = []
}
</script>

<template>
  <section class="selftest panel">
    <h2 class="st-title"><i class="bi bi-clipboard-check"></i> 测试回显面板</h2>
    <p class="st-sub">
      运行各功能模块的引擎自检，并逐路由隔离挂载组件捕获渲染期错误；任何 bug（含运行期
      <code>window error</code> / <code>unhandledrejection</code> / <code>console.error</code>）都会原样显示在此处。
    </p>

    <div class="st-actions">
      <button class="btn" :disabled="loading || viewLoading" @click="runEngine">
        <i class="bi bi-play-fill"></i> {{ loading ? '引擎自检中…' : '运行全部自检' }}
      </button>
      <button class="btn" :disabled="loading || viewLoading" @click="runViewSmoke">
        <i class="bi bi-eye"></i> {{ viewLoading ? '渲染自检中…' : '视图渲染自检' }}
      </button>
      <button class="btn ghost" :disabled="!runtimeErrors.length" @click="clearErrors">
        <i class="bi bi-eraser"></i> 清空运行期错误
      </button>
      <button class="btn ghost" :disabled="!report && !viewResults.length" @click="copyReport">
        <i class="bi bi-clipboard"></i> 复制报告
      </button>
    </div>

    <div v-if="report" class="st-summary">
      <span class="badge">模块 {{ report.modules.length }}</span>
      <span class="badge">子测试 {{ total }}</span>
      <span class="badge ok">通过 {{ passed }}</span>
      <span class="badge" :class="failed ? 'bad' : 'ok'">失败 {{ failed }}</span>
      <span class="badge" :class="skipped ? 'skip' : 'ok'">跳过 {{ skipped }}</span>
      <span class="badge" :class="runtimeErrors.length ? 'bad' : 'ok'">运行期错误 {{ runtimeErrors.length }}</span>
    </div>

    <!-- 运行期错误（红色高亮，任何 bug 都可在此看到）-->
    <div v-if="runtimeErrors.length" class="st-runtime">
      <h3><i class="bi bi-exclamation-triangle-fill"></i> 运行期错误（{{ runtimeErrors.length }}）</h3>
      <div v-for="(e, i) in runtimeErrors" :key="i" class="err-block">
        <div class="err-head">[{{ e.type }}] {{ e.message }}</div>
        <pre v-if="e.stack" class="err-stack">{{ e.stack }}</pre>
      </div>
    </div>

    <!-- 引擎自检结果树 -->
    <div v-if="report" class="st-modules">
      <div v-for="m in report.modules" :key="m.module" class="mod-card">
        <div class="mod-head">
          <strong>{{ m.module }}</strong>
          <span class="badge" :class="(m.items || []).some((i) => !i.ok) ? 'bad' : 'ok'">
            {{ (m.items || []).filter((i) => i.ok).length }}/{{ m.items ? m.items.length : 0 }}
          </span>
        </div>
        <div v-for="it in (m.items || [])" :key="it.id" class="item-row" :class="it.skipped ? 'skip' : (it.ok ? 'pass' : 'fail')">
          <span class="badge" :class="it.skipped ? 'skip' : (it.ok ? 'ok' : 'bad')">{{ it.skipped ? '↷ 跳过' : (it.ok ? '✓ PASS' : '✗ FAIL') }}</span>
          <span class="item-title">{{ it.title }}</span>
          <span v-if="it.detail" class="item-detail">{{ it.detail }}</span>
          <pre v-if="it.error" class="err-stack">[{{ it.error.message }}]\n{{ it.error.stack }}</pre>
        </div>
      </div>
    </div>

    <!-- 视图渲染自检结果 -->
    <div v-if="viewResults.length" class="st-views">
      <h3><i class="bi bi-layout-text-window"></i> 视图渲染自检</h3>
      <div v-for="v in viewResults" :key="v.path" class="item-row" :class="v.ok ? 'pass' : 'fail'">
        <span class="badge" :class="v.ok ? 'ok' : 'bad'">{{ v.ok ? '✓ PASS' : '✗ FAIL' }}</span>
        <span class="item-title">{{ v.path }}</span>
        <pre v-if="v.error" class="err-stack">[{{ v.error.message }}]\n{{ v.error.stack }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.selftest {
  margin: 28px 0;
  padding: 20px;
  border: 1px solid var(--border, #2a2f3a);
  border-radius: 12px;
}
.st-title {
  font-size: 18px;
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.st-sub {
  color: var(--muted, #9aa3b2);
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 14px;
}
.st-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.st-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: #2a2f3a;
  color: #cdd3df;
}
.badge.ok {
  background: #16361f;
  color: #6ee78a;
}
.badge.bad {
  background: #3a1722;
  color: #ff7a93;
}
.badge.skip {
  background: #3a3417;
  color: #e7d36e;
}
.st-runtime {
  background: #2a1419;
  border: 1px solid #5a2330;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
}
.st-runtime h3 {
  color: #ff7a93;
  font-size: 14px;
  margin: 0 0 8px;
}
.err-block {
  margin-bottom: 10px;
}
.err-head {
  color: #ffb3c1;
  font-size: 13px;
  word-break: break-word;
}
.err-stack {
  background: #1a1014;
  color: #ffd0d8;
  font-size: 12px;
  line-height: 1.5;
  padding: 8px;
  border-radius: 6px;
  margin: 6px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}
.st-modules {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mod-card {
  border: 1px solid var(--border, #2a2f3a);
  border-radius: 8px;
  padding: 10px 12px;
}
.mod-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.item-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px dashed #232833;
  flex-wrap: wrap;
}
.item-row.skip {
  opacity: 0.72;
}
.item-title {
  font-size: 13px;
}
.item-detail {
  font-size: 12px;
  color: var(--muted, #9aa3b2);
}
.st-views {
  margin-top: 16px;
}
.st-views h3 {
  font-size: 14px;
  margin: 0 0 8px;
}
.btn.ghost {
  background: transparent;
  border: 1px solid var(--border, #2a2f3a);
  color: var(--muted, #9aa3b2);
}
</style>
