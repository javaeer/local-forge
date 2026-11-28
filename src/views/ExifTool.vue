<script setup>
import { ref } from 'vue'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import { readMetadata, stripMetadata, LEVELS } from '../lib/exif.js'
import { createZip } from '../lib/archive.js'
import { formatSize, downloadBlob, basename } from '../utils.js'
import { T } from '../lib/i18n.dev.js'

const items = ref([]) // { file, meta, state, clean?:{blob,removed,removedBytes} }
const state = ref('idle')
const message = ref(null)
const busy = ref(false)

function setMsg(t, text) { message.value = { type: t, text } }

async function onFiles(fs) {
  items.value = (fs || []).map((f) => ({ file: f, meta: null, state: 'idle', error: null }))
  if (!items.value.length) return
  state.value = 'working'
  setMsg('info', T('ui.exif.reading', { n: items.value.length }))
  for (const it of items.value) {
    try {
      it.meta = await readMetadata(it.file)
      it.state = 'done'
    } catch (e) {
      it.error = e.message
      it.state = 'error'
    }
  }
  const withGps = items.value.filter((x) => x.meta && x.meta.gps).length
  const withExif = items.value.filter((x) => x.meta && x.meta.hasExif).length
  state.value = 'done'
  setMsg(
    withGps ? 'err' : withExif ? 'info' : 'ok',
    withGps
      ? T('ui.exif.msgGps', { n: withGps })
      : withExif
        ? T('ui.exif.msgExif', { n: withExif })
        : T('ui.exif.msgClean'),
  )
}

async function cleanOne(it) {
  try {
    const res = await stripMetadata(it.file)
    it.clean = res
    setMsg('ok', T('ui.exif.msgCleanOne', { name: it.file.name, n: res.removed, size: formatSize(res.removedBytes) }))
  } catch (e) {
    setMsg('err', T('ui.exif.errClean') + e.message)
  }
}

function downloadOne(it) {
  if (!it.clean) return
  const base = basename(it.file.name).replace(/\.[^.]+$/, '')
  const ext = it.clean.kind === 'png' ? 'png' : 'jpg'
  downloadBlob(it.clean.blob, `${base}-clean.${ext}`)
}

async function cleanAll() {
  const targets = items.value.filter((x) => x.meta && (x.meta.hasMeta || x.meta.hasExif) && !x.error)
  if (!targets.length) { setMsg('info', T('ui.exif.msgNothing')); return }
  busy.value = true
  try {
    for (const it of targets) {
      try { it.clean = await stripMetadata(it.file) } catch (e) { it.error = e.message }
    }
    const done = targets.filter((x) => x.clean)
    const files = done.map((it) => {
      const base = basename(it.file.name).replace(/\.[^.]+$/, '')
      const ext = it.clean.kind === 'png' ? 'png' : 'jpg'
      return new File([it.clean.blob], `${base}-clean.${ext}`, { type: it.clean.blob.type })
    })
    const zip = await createZip(files, { level: 6 })
    downloadBlob(zip, `cleaned-${files.length}-${Date.now()}.zip`)
    setMsg('ok', T('ui.exif.msgCleanAll', { n: done.length, size: formatSize(zip.size) }))
  } catch (e) {
    setMsg('err', T('ui.exif.errCleanAll') + e.message)
  } finally {
    busy.value = false
  }
}

function levelLabel(id) {
  return (LEVELS.find((l) => l.id === id) || {}).label || id
}
function fmtValue(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
</script>

<template>
  <h1 class="page-title">{{ T('ui.exif.pageTitle') }}</h1>
  <p class="page-sub" v-html="T('ui.exif.sub')"></p>

  <HelpTip :title="T('ui.exif.helpTitle')" icon="bi-shield-lock" open>
    <ol class="howto">
      <li v-html="T('ui.exif.help1')"></li>
      <li v-html="T('ui.exif.help2')"></li>
      <li v-html="T('ui.exif.help3')"></li>
    </ol>
    <p style="margin:8px 0 0">{{ T('ui.exif.helpNote') }}</p>
  </HelpTip>

  <DropZone
    multiple accept="image/jpeg,image/png" :single="T('ui.exif.single')"
    :hint="T('ui.exif.dropHint')"
    :formats="T('ui.exif.formats')"
    @files="onFiles"
  />

  <div class="row wrap" style="margin-top:12px">
    <button class="btn green" :disabled="busy || !items.some((x) => x.meta && (x.meta.hasMeta || x.meta.hasExif))" @click="cleanAll">
      <i class="bi bi-eraser"></i> {{ busy ? T('ui.exif.btnBusy') : T('ui.exif.btnCleanAll') }}
    </button>
    <StatusPill :state="state" :label="state === 'working' ? T('ui.exif.stReading') : state === 'done' ? T('ui.exif.stRead', { n: items.length }) : T('ui.exif.stWait')" />
  </div>

  <div v-if="items.length" class="list">
    <div v-for="it in items" :key="it.file.name + it.file.size" class="card">
      <div class="head">
        <i class="bi bi-image"></i>
        <span class="name">{{ it.file.name }}</span>
        <span class="tag">{{ formatSize(it.file.size) }}</span>
        <span v-if="it.error" class="tag danger"><i class="bi bi-exclamation-triangle"></i> {{ it.error }}</span>
        <template v-else-if="it.meta">
          <span v-if="it.meta.gps" class="tag danger"><i class="bi bi-geo-alt"></i> {{ T('ui.exif.tagGps') }}</span>
          <span v-else-if="it.meta.hasExif" class="tag warn"><i class="bi bi-info-circle"></i> {{ T('ui.exif.tagExif') }}</span>
          <span v-else class="tag ok"><i class="bi bi-check-circle"></i> {{ T('ui.exif.tagNone') }}</span>
          <span v-if="it.clean" class="tag ok"><i class="bi bi-eraser"></i> {{ T('ui.exif.tagCleaned', { n: it.clean.removed }) }}</span>
        </template>
      </div>

      <div v-if="it.meta && it.meta.gps" class="gps">
        <i class="bi bi-geo-alt-fill"></i>
        {{ T('ui.exif.coords') }}<b>{{ T('ui.exif.latLng', { lat: it.meta.gps.lat, lng: it.meta.gps.lng }) }}</b>
        <span v-if="it.meta.gps.altitude != null">{{ T('ui.exif.altitude', { alt: it.meta.gps.altitude }) }}</span>
        <span v-if="it.meta.gps.date"> · {{ it.meta.gps.date }}</span>
      </div>

      <div v-if="it.meta && it.meta.tags.length" class="tags">
        <div v-for="(t, i) in it.meta.tags" :key="i" class="row-tag" :class="t.level">
          <span class="lv">{{ levelLabel(t.level) }}</span>
          <span class="k">{{ t.label }}</span>
          <span class="v">{{ fmtValue(t.value) }}</span>
        </div>
      </div>
      <p v-else-if="it.meta" class="hint" style="margin:8px 0 0">{{ T('ui.exif.noMeta') }}</p>

      <div v-if="it.meta && !it.error" class="row wrap" style="margin-top:10px">
        <button class="btn ghost" :disabled="!it.meta.hasMeta && !it.meta.hasExif" @click="cleanOne(it)">
          <i class="bi bi-eraser"></i> {{ T('ui.exif.btnCleanOne') }}
        </button>
        <button class="btn" :disabled="!it.clean" @click="downloadOne(it)">
          <i class="bi bi-download"></i> {{ T('ui.exif.btnDownload') }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="items.length" class="panel" style="margin-top:14px">
    <h3 class="sec-title"><i class="bi bi-diagram-3"></i> {{ T('ui.exif.levelTitle') }}</h3>
    <div v-for="l in LEVELS" :key="l.id" class="row-tag" :class="l.id">
      <span class="lv">{{ l.label }}</span><span class="k">{{ l.desc }}</span>
    </div>
    <p class="hint">{{ T('ui.exif.cleanHint') }}</p>
  </div>

  <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
</template>

<style scoped>
.sec-title { margin: 0 0 10px; font-size: 14px; color: var(--txt, #e6ebf2); display: flex; align-items: center; gap: 7px; }
.sec-title i { color: var(--accent, #38bdf8); }
.list { margin-top: 14px; display: grid; gap: 12px; }
.card { border: 1px solid var(--line, rgba(120,150,200,.16)); border-radius: 12px; padding: 12px; background: var(--panel-2, rgba(28,37,60,.5)); }
.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.head > i { color: var(--accent, #38bdf8); }
.head .name { color: var(--txt, #e6ebf2); font-weight: 600; font-size: 13.5px; }
.tag { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line-strong, rgba(120,150,200,.32)); color: var(--muted, #93a2bd); }
.tag.danger { color: var(--danger, #fb7185); border-color: rgba(251,113,133,.45); background: rgba(251,113,133,.1); }
.tag.warn { color: var(--warn, #fbbf24); border-color: rgba(251,191,36,.4); background: rgba(251,191,36,.1); }
.tag.ok { color: var(--accent-2, #34d399); border-color: rgba(52,211,153,.45); background: rgba(52,211,153,.1); }
.gps {
  margin-top: 10px; padding: 9px 12px; border-radius: 10px; font-size: 13px;
  background: rgba(251,113,133,.1); border-left: 3px solid var(--danger, #fb7185); color: #ffc4cf;
}
.tags { margin-top: 10px; display: grid; gap: 2px; }
.row-tag {
  display: flex; gap: 10px; align-items: baseline; font-size: 12.5px;
  padding: 4px 8px; border-radius: 8px; border-left: 3px solid var(--line, rgba(120,150,200,.2));
}
.row-tag .lv { flex: none; width: 62px; color: var(--muted, #93a2bd); font-size: 11.5px; }
.row-tag .k { flex: none; width: 110px; color: var(--muted, #93a2bd); }
.row-tag .v { color: var(--txt, #e6ebf2); word-break: break-all; }
.row-tag.high { border-left-color: var(--danger, #fb7185); background: rgba(251,113,133,.07); }
.row-tag.mid { border-left-color: var(--warn, #fbbf24); background: rgba(251,191,36,.06); }
.row-tag.low { border-left-color: var(--line-strong, rgba(120,150,200,.32)); }
</style>
