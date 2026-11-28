<script setup>
// 批处理队列（B-1）：一次拖入多份文件，套用同一操作 + 预设，串行处理。
// 复用了图片/PDF/EXIF/压缩等既有引擎，无需为每个工具单独排队。
import { ref, computed } from 'vue'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import PhaseProgress from '../components/PhaseProgress.vue'
import { OPS, OP_LIST, PRESETS, runBatch, filterAcceptable } from '../lib/batch.js'
import { createProgress } from '../lib/progress.js'
import { formatSize, downloadBlob } from '../utils.js'
import { createZip } from '../lib/archive.js'
import { pushToast } from '../lib/toast.js'
import { t } from '../lib/i18n.js'
import { T } from '../lib/i18n.dev.js'

const files = ref([])
const opId = ref('image-compress')
const presetId = ref('')
const quality = ref(0.8)
const maxEdge = ref(1600)
const wmText = ref('LocalForge')
const wmPos = ref('bottom-right')
const busy = ref(false)
const cancelled = ref(false)
const items = ref([])        // [{ name, status, progress, out, error }]
const results = ref([])      // 成功结果（供打包）
const op = computed(() => OPS[opId.value])

const eligible = computed(() => filterAcceptable(files.value, opId.value))
const skipped = computed(() => files.value.length - eligible.value.length)

const phase = createProgress([
  { id: 'queue', label: T('ui.batch.phaseQueue'), weight: 1 },
])

function onFiles(list) {
  files.value = [...list]
  items.value = list.map((f) => ({ name: f.name, size: f.size, status: 'idle', progress: 0, out: '', error: '' }))
  results.value = []
}

async function applyPreset() {
  const p = PRESETS.find((x) => x.id === presetId.value)
  if (!p) return
  opId.value = p.op
  if (p.params.quality != null) quality.value = p.params.quality
  if (p.params.maxEdge != null) maxEdge.value = p.params.maxEdge
  if (p.params.text != null) wmText.value = p.params.text
  if (p.params.position != null) wmPos.value = p.params.position
  pushToast('ok', T('ui.batch.toastPreset', { name: p.label }))
}

async function start() {
  if (busy.value || !files.value.length) return
  busy.value = true
  cancelled.value = false
  results.value = []
  items.value = eligible.value.map((f) => ({ name: f.name, size: f.size, status: 'queued', progress: 0, out: '', error: '' }))

  const params = {}
  if (opId.value === 'image-compress' || opId.value === 'image-convert') {
    params.quality = Number(quality.value)
    if (opId.value === 'image-convert') params.outMime = 'image/webp'
  }
  if (opId.value === 'image-resize') params.maxEdge = Number(maxEdge.value)
  if (opId.value === 'image-watermark') { params.text = wmText.value; params.position = wmPos.value }

  phase.reset()
  await runBatch(eligible.value, opId.value, params, {
    shouldCancel: () => cancelled.value,
    onItem: ({ index, total, status, progress, result, error }) => {
      const it = items.value[index]
      if (!it) return
      it.status = status
      it.progress = progress || 0
      if (result) { it.out = result.name; it.size = result.blob.size }
      if (error) it.error = error
      // 队列总进度：已完成数 + 当前项进度
      phase.set('queue', (index + (status === 'done' || status === 'error' ? 1 : progress || 0)) / total)
    },
    onDone: ({ results: rs, cancelled: c }) => {
      results.value = rs.filter((r) => r.ok)
      cancelled.value = c
    },
  })
  phase.finish()
  busy.value = false
  pushToast(results.value.length ? 'ok' : 'err', cancelled.value ? T('ui.batch.toastCancelled') : T('ui.batch.toastDone', { n: results.value.length, m: items.value.length }))
}

function cancel() { cancelled.value = true }

function downloadOne(it, idx) {
  const r = results.value.find((x) => x.src === it.name)
  if (r) downloadBlob(r.blob, r.name)
}
async function downloadZip() {
  if (!results.value.length) return
  busy.value = true
  try {
    const zipFiles = results.value.map((r) => new File([r.blob], r.name, { type: r.blob.type }))
    const blob = await createZip(zipFiles, { level: 6 })
    downloadBlob(blob, 'batch-output.zip')
    pushToast('ok', T('ui.batch.toastZipped'))
  } finally { busy.value = false }
}
const statusText = (s) => ({ idle: T('ui.batch.stIdle'), queued: T('ui.batch.stQueued'), running: T('ui.batch.stRunning'), done: T('ui.batch.stDone'), error: T('ui.batch.stError') }[s] || s)
</script>

<template>
  <h1 class="page-title">{{ T('ui.batch.pageTitle') }}</h1>
  <p class="page-sub">{{ T('ui.batch.sub') }}</p>

  <HelpTip :title="T('ui.batch.helpTitle')" icon="bi-list-task" open tone="tip">
    <ol class="howto">
      <li>{{ T('ui.batch.help1') }}</li>
      <li>{{ T('ui.batch.help2') }}</li>
      <li>{{ T('ui.batch.help3') }}</li>
    </ol>
  </HelpTip>

  <DropZone :multiple="true" accept="image/*,application/pdf,.zip" :single="T('ui.batch.single')" :hint="T('ui.batch.dropHint')" formats="PNG / JPG / WEBP / PDF / ZIP…" @files="onFiles" />

  <div v-if="files.length" class="panel">
    <div class="row wrap">
      <div class="field">
        <label>{{ T('ui.batch.operation') }}</label>
        <select v-model="opId" :disabled="busy">
          <option v-for="o in OP_LIST" :key="o.id" :value="o.id">{{ o.label }}</option>
        </select>
      </div>
      <div class="field">
        <label>{{ T('ui.batch.presetOptional') }}</label>
        <select v-model="presetId" :disabled="busy" @change="applyPreset">
          <option value="">{{ T('ui.batch.customPreset') }}</option>
          <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </div>
      <div class="field" v-if="opId === 'image-compress' || opId === 'image-convert'">
        <label>{{ T('ui.batch.quality', { n: Math.round(quality * 100) }) }}</label>
        <input type="range" min="0.1" max="1" step="0.05" v-model.number="quality" :disabled="busy" />
      </div>
      <div class="field" v-if="opId === 'image-resize'">
        <label>{{ T('ui.batch.maxEdge') }}</label>
        <input type="number" min="64" max="8000" step="16" v-model.number="maxEdge" :disabled="busy" style="width:110px" />
      </div>
      <div class="field" v-if="opId === 'image-watermark'">
        <label>{{ T('ui.batch.watermark') }}</label>
        <input type="text" v-model="wmText" :disabled="busy" style="width:150px" />
      </div>
      <div class="field" v-if="opId === 'image-watermark'">
        <label>{{ T('ui.batch.position') }}</label>
        <select v-model="wmPos" :disabled="busy">
          <option value="bottom-right">{{ T('ui.batch.posBottomRight') }}</option>
          <option value="bottom-left">{{ T('ui.batch.posBottomLeft') }}</option>
          <option value="top-right">{{ T('ui.batch.posTopRight') }}</option>
          <option value="center">{{ T('ui.batch.posCenter') }}</option>
          <option value="tile">{{ T('ui.batch.posTile') }}</option>
        </select>
      </div>
      <button class="btn" :disabled="busy || !eligible.length" @click="start">
        <i class="bi bi-play-fill"></i> {{ T('ui.batch.btnStart') }}
      </button>
      <button v-if="busy" class="btn ghost" @click="cancel"><i class="bi bi-stop-fill"></i> {{ T('ui.batch.btnCancel') }}</button>
    </div>

    <div class="status">
      {{ T('ui.batch.total') }} <b style="color:var(--txt)">{{ files.length }}</b> {{ T('ui.batch.files') }}
      · {{ T('ui.batch.eligible') }} <b style="color:var(--accent)">{{ eligible.length }}</b>
      <span v-if="skipped"> · {{ T('ui.batch.skipped') }} <b>{{ skipped }}</b></span>
    </div>

    <PhaseProgress v-if="busy" :progress="phase" />

    <div class="queue">
      <div v-for="(it, i) in items" :key="i" class="qitem" :class="it.status">
        <i class="bi" :class="{
          'bi-hourglass-split': it.status === 'idle' || it.status === 'queued',
          'bi-arrow-repeat': it.status === 'running',
          'bi-check-circle-fill': it.status === 'done',
          'bi-x-circle-fill': it.status === 'error',
        }"></i>
        <span class="qname">{{ it.name }}</span>
        <span class="qsize">{{ formatSize(it.size) }}</span>
        <span class="qstate">{{ it.error || statusText(it.status) }}</span>
        <span class="qbar" v-if="it.status === 'running'"><i :style="{ width: Math.round((it.progress || 0) * 100) + '%' }"></i></span>
        <button v-if="it.status === 'done'" class="btn ghost sm" @click="downloadOne(it, i)"><i class="bi bi-download"></i></button>
      </div>
    </div>

    <div v-if="results.length" class="actions">
      <button class="btn green" :disabled="busy" @click="downloadZip">
        <i class="bi bi-file-earmark-zip"></i> {{ T('ui.batch.btnZip', { n: results.length }) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.queue { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.qitem {
  display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 10px;
  border: 1px solid var(--line, rgba(120,150,200,.16)); background: var(--panel-2, rgba(28,37,60,.55));
  font-size: 13px; color: var(--txt, #e8edf7);
}
.qitem > i { color: var(--muted, #93a2bd); width: 16px; text-align: center; flex: none; }
.qitem.running > i { color: var(--accent, #38bdf8); animation: spin 1s linear infinite; }
.qitem.done > i { color: var(--accent-2, #34d399); }
.qitem.error > i { color: #f87171; }
@keyframes spin { to { transform: rotate(360deg); } }
.qname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qsize { color: var(--faint, #6b7a96); font-size: 12px; flex: none; font-variant-numeric: tabular-nums; }
.qstate { color: var(--muted, #93a2bd); font-size: 12px; flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qitem.error .qstate { color: #fca5a5; }
.qbar { width: 70px; height: 5px; border-radius: 999px; background: rgba(120,150,200,.18); overflow: hidden; flex: none; }
.qbar i { display: block; height: 100%; background: var(--grad, linear-gradient(90deg,#38bdf8,#a78bfa)); }
.btn.sm { padding: 5px 9px; }
.actions { margin-top: 14px; }
</style>
