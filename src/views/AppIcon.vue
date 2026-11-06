<script setup>
// App 图标多尺寸生成器：上传已有 Logo，一次裁剪决策，批量导出商店 / iOS / Android 预设 PNG。
// 纯浏览器本地：不上传、不联网、不用 AI、不调用任何平台接口。
// 内核见 src/lib/app-icon.js（零依赖纯函数，Node 可单测；UPNG 保证 App Store 产物无 alpha 通道）。
import { ref, computed, onMounted, onUnmounted } from 'vue'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import NextSteps from '../components/NextSteps.vue'
import { decodeToImageData } from '../lib/image.js'
import {
  ICON_GROUPS, ICON_PRESETS, DEFAULT_PRESET_IDS,
  planIconSet, renderIconSet, buildIconZip,
} from '../lib/app-icon.js'
import { formatSize, downloadBlob } from '../utils.js'
import { pushToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'
import { consumePending } from '../lib/workflow.js'

const file = ref(null)
const source = ref(null)                       // { data, width, height }，一次解码复用
const fit = ref('cover')                       // cover 裁剪填满 | contain 完整保留
const background = ref('#ffffff')              // 纯色背景（contain 留白 / 透明区合成）
const selected = ref([...DEFAULT_PRESET_IDS])
const entries = ref([])
const busy = ref(false)
const message = ref(null)
const previewUrls = ref({})

const groups = computed(() => ICON_GROUPS.map((g) => ({
  ...g,
  presets: ICON_PRESETS.filter((p) => p.group === g.id),
})))
const plan = computed(() => planIconSet({
  presetIds: selected.value, fit: fit.value, background: background.value,
}))
const planIssues = computed(() => plan.value.issues || [])
const allIssues = computed(() => [
  ...planIssues.value,
  ...entries.value.flatMap((e) => (e.issues || []).map((i) => ({ ...i, name: e.name }))),
])
const isSelected = (id) => selected.value.includes(id)

// 诊断文案映射：每项都写成静态字符串 T 调用，以便一致性护栏能扫描到这些 key
const ISSUE_TEXT = {
  'bg-invalid': () => T('views.appIcon.issueBg'),
  'fit-invalid': () => T('views.appIcon.issueFit'),
  'no-preset': () => T('views.appIcon.issueNoPreset'),
  'icon-size-mismatch': () => T('views.appIcon.issueSize'),
  'icon-alpha-channel': () => T('views.appIcon.issueAlpha'),
  'icon-too-large': () => T('views.appIcon.issueTooLarge'),
}
const issueText = (i) => (ISSUE_TEXT[i.code] ? ISSUE_TEXT[i.code]() : i.code)

function revokeAll() {
  for (const u of Object.values(previewUrls.value)) URL.revokeObjectURL(u)
  previewUrls.value = {}
}

async function onFiles(list) {
  const f = list && list[0]
  if (!f) return
  file.value = f
  source.value = null
  entries.value = []
  message.value = null
  revokeAll()
  try {
    const img = await decodeToImageData(f)
    source.value = { data: img.data, width: img.width, height: img.height }
    pushToast('ok', T('views.appIcon.toastLoaded'))
    await run()
  } catch (e) {
    message.value = { type: 'err', text: T('views.appIcon.msgFail', { msg: e.message || String(e) }) }
  }
}

async function onPaste(e) {
  const items = (e.clipboardData && e.clipboardData.items) || []
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) {
        e.preventDefault()
        await onFiles([f])
        pushToast('ok', T('views.appIcon.toastPasted'))
        return
      }
    }
  }
}

async function run() {
  if (!source.value) {
    message.value = { type: 'err', text: T('views.appIcon.msgNoSource') }
    return
  }
  busy.value = true
  message.value = { type: 'info', text: T('views.appIcon.statusWorking') }
  try {
    // 让出一次事件循环，保证 busy 状态先渲染（内核是同步纯计算）
    await new Promise((r) => setTimeout(r, 16))
    const p = plan.value
    const outs = renderIconSet(source.value, p.presets, {
      fit: p.fit, background: p.background.rgb,
    })
    revokeAll()
    const urls = {}
    for (const o of outs) {
      urls[o.name] = URL.createObjectURL(new Blob([o.bytes], { type: 'image/png' }))
    }
    previewUrls.value = urls
    entries.value = outs
    message.value = { type: 'ok', text: T('views.appIcon.msgDone', { n: outs.length }) }
    pushToast('ok', T('views.appIcon.toastGenerated'))
  } catch (e) {
    message.value = { type: 'err', text: T('views.appIcon.msgFail', { msg: e.message || String(e) }) }
  } finally {
    busy.value = false
  }
}

function togglePreset(p) {
  if (p.required) return
  const next = new Set(selected.value)
  if (next.has(p.id)) next.delete(p.id)
  else next.add(p.id)
  selected.value = ICON_PRESETS.filter((x) => next.has(x.id)).map((x) => x.id)
}
function toggleGroup(g, on) {
  const next = new Set(selected.value)
  for (const p of g.presets) {
    if (p.required) continue
    if (on) next.add(p.id)
    else next.delete(p.id)
  }
  selected.value = ICON_PRESETS.filter((x) => next.has(x.id)).map((x) => x.id)
}
function selectAll() { selected.value = ICON_PRESETS.map((p) => p.id) }
function selectNone() { selected.value = ICON_PRESETS.filter((p) => p.required).map((p) => p.id) }

function downloadOne(e) {
  downloadBlob(new Blob([e.bytes], { type: 'image/png' }), e.name)
}
function downloadZip() {
  if (!entries.value.length) return
  downloadBlob(new Blob([buildIconZip(entries.value)], { type: 'application/zip' }), 'app-icons.zip')
  pushToast('ok', T('views.appIcon.toastZip'))
}
function collectResultFiles() {
  return entries.value.map((e) => ({
    blob: new Blob([e.bytes], { type: 'image/png' }), name: e.name,
  }))
}

onMounted(() => {
  window.addEventListener('paste', onPaste)
  const pending = consumePending()
  if (pending && pending.files.length) onFiles([pending.files[0]])
})
onUnmounted(() => {
  window.removeEventListener('paste', onPaste)
  revokeAll()
})
</script>

<template>
  <h1 class="page-title">{{ T('views.appIcon.title') }}</h1>
  <p class="page-sub">{{ T('views.appIcon.sub') }}</p>

  <HelpTip :title="T('views.appIcon.helpTitle')" icon="bi-steps" open>
    <ol class="howto">
      <li>{{ T('views.appIcon.help1') }}</li>
      <li>{{ T('views.appIcon.help2') }}</li>
      <li>{{ T('views.appIcon.help3') }}</li>
      <li>{{ T('views.appIcon.help4') }}</li>
    </ol>
    <p style="margin:8px 0 0">{{ T('views.appIcon.noteOpaque') }}</p>
  </HelpTip>

  <DropZone
    :multiple="false" accept="image/*" :single="T('views.appIcon.dropSingle')"
    :hint="T('views.appIcon.dropHint')" :formats="T('views.appIcon.dropFormats')"
    @files="onFiles"
  />

  <div class="panel">
    <div class="row wrap" style="margin-top:0">
      <StatusPill v-if="busy" state="working" :label="T('views.appIcon.statusWorking')" />
      <StatusPill v-else-if="entries.length" state="done" :label="T('views.appIcon.statusDone')" />
      <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
      <span class="hint" v-if="source">
        {{ T('views.appIcon.sourceInfo', { w: source.width, h: source.height }) }}
      </span>
      <span class="hint" v-else>{{ T('views.appIcon.sourceNone') }}</span>
    </div>

    <p v-if="source && (source.width < 1024 || source.height < 1024)" class="msg err">
      {{ T('views.appIcon.smallSourceWarn') }}
    </p>

    <div class="row wrap">
      <div class="field">
        <label>{{ T('views.appIcon.fitLabel') }}</label>
        <select v-model="fit" class="fit-select">
          <option value="cover">{{ T('views.appIcon.fitCover') }}</option>
          <option value="contain">{{ T('views.appIcon.fitContain') }}</option>
        </select>
      </div>
      <div class="field">
        <label>{{ T('views.appIcon.bgLabel') }}</label>
        <span class="row" style="gap:6px">
          <input type="color" v-model="background" class="bg-color" aria-label="background" />
          <input type="text" v-model="background" class="bg-text" maxlength="7" spellcheck="false" />
        </span>
      </div>
      <button class="btn" :disabled="busy || !source" @click="run">
        <i class="bi bi-grid-1x2"></i> {{ T('views.appIcon.btnGenerate') }}
      </button>
    </div>
    <p class="hint">{{ fit === 'cover' ? T('views.appIcon.fitCoverHint') : T('views.appIcon.fitContainHint') }}</p>
    <p class="hint">{{ T('views.appIcon.bgHint') }}</p>

    <div class="preset-head">
      <strong>{{ T('views.appIcon.presetTitle') }}</strong>
      <span class="row" style="gap:6px">
        <button class="btn tiny" type="button" @click="selectAll">{{ T('views.appIcon.selectAll') }}</button>
        <button class="btn tiny" type="button" @click="selectNone">{{ T('views.appIcon.selectNone') }}</button>
      </span>
    </div>

    <div v-for="g in groups" :key="g.id" class="preset-group">
      <div class="preset-group-head">
        <label class="chk">
          <input type="checkbox" :checked="g.presets.every(isSelected)" @change="toggleGroup(g, $event.target.checked)" />
          <strong>{{ T(g.labelKey) }}</strong>
        </label>
        <span class="hint">{{ T(g.hintKey) }}</span>
        <span class="row" style="gap:6px">
          <button class="btn tiny" type="button" @click="toggleGroup(g, true)">+</button>
          <button class="btn tiny" type="button" @click="toggleGroup(g, false)">−</button>
        </span>
      </div>
      <div class="preset-list">
        <label v-for="p in g.presets" :key="p.id" class="preset-item" :class="{ on: isSelected(p.id) }">
          <input
            type="checkbox" class="preset-cb" :data-id="p.id"
            :checked="isSelected(p.id)" :disabled="p.required" @change="togglePreset(p)"
          />
          <span class="preset-name">{{ p.name }}</span>
          <span class="preset-size">{{ p.size }}×{{ p.size }}</span>
          <span v-if="p.required" class="preset-badge">{{ T('views.appIcon.required') }}</span>
        </label>
      </div>
    </div>

    <p class="hint">{{ T('views.appIcon.noteAdaptive') }}</p>

    <div v-if="message" class="msg" :class="message.type">{{ message.text }}</div>
    <ul v-if="allIssues.length" class="issue-list">
      <li v-for="(i, k) in allIssues" :key="k" :class="i.level === 'error' ? 'error' : 'warning'">
        {{ issueText(i) }}{{ i.name ? ' · ' + i.name : '' }}
      </li>
    </ul>

    <div v-if="entries.length" class="icon-result">
      <div class="preset-head">
        <strong>{{ T('views.appIcon.previewTitle') }}</strong>
        <button class="btn green" type="button" @click="downloadZip">
          <i class="bi bi-file-earmark-zip"></i> {{ T('views.appIcon.btnZip') }}
        </button>
      </div>
      <div class="icon-grid">
        <article
          v-for="e in entries" :key="e.name" class="icon-card"
          :data-name="e.name" :data-size="e.width" :data-colortype="e.colorType"
        >
          <div class="icon-thumb"><img :src="previewUrls[e.name]" :alt="e.name" /></div>
          <div class="icon-name">{{ e.name }}</div>
          <div class="icon-meta">
            {{ e.width }}×{{ e.height }} · {{ formatSize(e.bytes.length) }} ·
            {{ e.preset.opaque ? T('views.appIcon.labelOpaque') : T('views.appIcon.labelAlpha') }}
          </div>
          <div class="icon-meta">{{ T('views.appIcon.labelColorType') }} {{ e.colorType }}</div>
          <button class="btn tiny" type="button" @click="downloadOne(e)">
            <i class="bi bi-download"></i> PNG
          </button>
        </article>
      </div>
      <NextSteps from="/app-icon" :get-files="collectResultFiles" :title="T('views.appIcon.nextTitle')" />
    </div>
  </div>
</template>

<style scoped>
.preset-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 16px 0 8px; flex-wrap: wrap; }
.preset-group { border: 1px solid var(--line, #2a3447); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
.preset-group-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.preset-group-head .hint { flex: 1; min-width: 180px; }
.preset-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 6px; }
.preset-item { display: flex; align-items: center; gap: 7px; padding: 5px 8px; border-radius: 7px; background: var(--panel-2, rgba(28,37,60,.5)); font-size: 13px; cursor: pointer; }
.preset-item.on { outline: 1px solid var(--accent, #5b8cff); }
.preset-name { flex: 1; font-family: ui-monospace, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preset-size { opacity: .7; font-size: 11px; }
.preset-badge { font-size: 10px; padding: 1px 5px; border-radius: 4px; background: var(--accent, #5b8cff); color: #fff; }
.btn.tiny { padding: 3px 9px; font-size: 12px; }
.bg-color { width: 40px; height: 32px; padding: 0; border: 1px solid var(--line, #2a3447); border-radius: 6px; background: none; }
.bg-text { width: 92px; font-family: ui-monospace, monospace; }
.icon-result { margin-top: 18px; }
.icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.icon-card { border: 1px solid var(--line, #2a3447); border-radius: 10px; padding: 10px; text-align: center; background: var(--panel-2, rgba(28,37,60,.45)); }
.icon-thumb { height: 110px; display: flex; align-items: center; justify-content: center; background: repeating-conic-gradient(#2a3447 0% 25%, #1c253c 0% 50%) 50% / 16px 16px; border-radius: 6px; overflow: hidden; margin-bottom: 8px; }
.icon-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; image-rendering: auto; }
.icon-name { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
.icon-meta { font-size: 11px; opacity: .75; margin: 3px 0; }
.issue-list { margin: 10px 0; padding-left: 20px; font-size: 13px; }
.issue-list li.error { color: #f87171; }
.issue-list li.warning { color: #fbbf24; }
</style>
