<script setup>
import { ref, computed, onMounted } from 'vue'
import { T } from '../lib/i18n.dev.js'
import HelpTip from '../components/HelpTip.vue'
import StatusPill from '../components/StatusPill.vue'
import PhaseProgress from '../components/PhaseProgress.vue'
import {
  getBridgeUrl,
  setBridgeUrl,
  parseUrls,
  fetchMediaBlob,
  mergeParts,
  ensureCore,
} from '../lib/mediadl.js'
import { onProgress as mediaOnProgress, setCoreLoadHook as mediaSetCoreLoadHook } from '../lib/media.js'
import { createProgress } from '../lib/progress.js'
import { formatSize, downloadBlob } from '../utils.js'

const input = ref('')
const useBridge = ref(false)
const bridgeUrl = ref('')
const items = ref([]) // { url, name, blob, size, progress, status, error }
const busy = ref(false)
const message = ref(null)

const phase = createProgress([
  { id: 'core', label: T('ui.mediafetch.phaseCore'), weight: 2 },
  { id: 'fetch', label: T('ui.mediafetch.phaseFetch'), weight: 6 },
  { id: 'merge', label: T('ui.mediafetch.phaseMerge'), weight: 4 },
])
const showPhase = ref(false)

const urlCount = computed(() => parseUrls(input.value).length)

onMounted(() => {
  bridgeUrl.value = getBridgeUrl()
  mediaOnProgress((p) => { if (busy.value) phase.set('fetch', p) })
  mediaSetCoreLoadHook((s) => {
    if (s === 'start') phase.set('core', 0.15)
    else if (s === 'end') phase.set('core', 1)
    else phase.set('core', 0)
  })
})

function onBridgeInput() {
  setBridgeUrl(useBridge.value ? bridgeUrl.value : '')
}

async function fetchOne(url, viaBridge) {
  const it = { url, name: url, blob: null, size: 0, progress: 0, status: 'working', error: null }
  items.value.push(it)
  try {
    const { blob, size, filename } = await fetchMediaBlob(url, {
      viaBridge,
      onProgress: (p) => { it.progress = p },
    })
    it.blob = blob
    it.size = size
    it.name = filename
    it.status = 'done'
    it.progress = 100
  } catch (e) {
    it.status = 'error'
    it.error = e.message || String(e)
  }
  return it
}

async function fetchAll() {
  const urls = parseUrls(input.value)
  if (!urls.length) {
    message.value = { type: 'err', text: T('ui.mediafetch.errNoUrl') }
    return
  }
  busy.value = true
  phase.reset()
  showPhase.value = true
  message.value = { type: 'info', text: T('ui.mediafetch.startFetch') }
  let ok = 0
  try {
    for (const u of urls) {
      const it = await fetchOne(u, useBridge.value)
      if (it.status === 'done') ok++
    }
    message.value = ok
      ? { type: 'ok', text: T('ui.mediafetch.fetched', { ok, total: urls.length }) }
      : { type: 'err', text: T('ui.mediafetch.allFailed') }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.mediafetch.fetchFailed', { msg: e.message || e }) }
  } finally {
    busy.value = false
    phase.finish()
  }
}

async function merge() {
  const done = items.value.filter((i) => i.status === 'done' && i.blob)
  if (done.length < 2) {
    message.value = { type: 'err', text: T('ui.mediafetch.mergeNeedTwo') }
    return
  }
  busy.value = true
  phase.reset()
  showPhase.value = true
  message.value = { type: 'info', text: T('ui.mediafetch.loadingMerge') }
  try {
    // 内核已就绪时直接置满，避免阶段卡在"内核"
    phase.set('core', 1)
    await ensureCore()
    const blob = await mergeParts(
      done.map((i) => i.blob),
      'merged.mp4',
      'video/mp4',
      { onProgress: (p) => phase.set('merge', p / 100) },
    )
    items.value.push({
      url: 'merged://local',
      name: 'merged.mp4',
      blob,
      size: blob.size,
      progress: 100,
      status: 'done',
      error: null,
    })
    phase.finish()
    message.value = { type: 'ok', text: T('ui.mediafetch.mergeDone', { size: formatSize(blob.size) }) }
  } catch (e) {
    message.value = { type: 'err', text: T('ui.mediafetch.mergeFailed', { msg: e.message || e }) }
  } finally {
    busy.value = false
  }
}

function download(it) {
  if (it.blob) downloadBlob(it.blob, it.name)
}
</script>

<template>
  <h1 class="page-title">{{ T('ui.mediafetch.title') }}</h1>
  <p class="page-sub">{{ T('ui.mediafetch.sub') }}</p>

  <HelpTip :title="T('ui.common.helpTitle')" icon="bi-steps" open tone="tip">
    <div v-html="T('ui.mediafetch.help')"></div>
  </HelpTip>

  <div class="panel">
    <div class="row wrap">
      <StatusPill v-if="busy" state="working" :label="T('ui.common.processing')" />
      <StatusPill v-else-if="message && message.type === 'ok'" state="done" :label="message.text" />
      <StatusPill v-else-if="message && message.type === 'err'" state="error" :label="message.text" />
    </div>

    <div class="field col">
      <label>{{ T('ui.mediafetch.linkLabel') }}</label>
      <textarea v-model="input" rows="4" placeholder="https://example.com/video/part1.ts&#10;https://example.com/video/part2.ts" :disabled="busy"></textarea>
      <div class="hint">{{ T('ui.mediafetch.parsedCount', { n: urlCount }) }}</div>
    </div>

    <div class="row wrap">
      <label class="check"><input type="checkbox" v-model="useBridge" @change="onBridgeInput" :disabled="busy" /> {{ T('ui.mediafetch.bridgeMode') }}</label>
    </div>
    <div class="field col" v-if="useBridge">
      <label>{{ T('ui.mediafetch.bridgeAddr') }}</label>
      <input v-model="bridgeUrl" @input="onBridgeInput" :placeholder="T('ui.mediafetch.bridgePlaceholder')" :disabled="busy" />
      <div class="hint" v-html="T('ui.mediafetch.bridgeHint')"></div>
    </div>

    <div class="row wrap">
      <button class="btn" :disabled="busy || !urlCount" @click="fetchAll"><i class="bi bi-cloud-download"></i> {{ T('ui.mediafetch.btnFetch') }}</button>
      <button class="btn" :disabled="busy || items.filter(i=>i.status==='done'&&i.blob).length < 2" @click="merge"><i class="bi bi-object-union"></i> {{ T('ui.mediafetch.btnMerge') }}</button>
    </div>

    <PhaseProgress v-if="busy && showPhase" :progress="phase" />

    <div v-if="message" class="msg" :class="message.type === 'err' ? 'err' : (message.type === 'ok' ? 'ok' : 'info')">
      {{ message.text }}
    </div>
  </div>

  <div v-if="items.length" class="panel">
    <h3 class="st-title">{{ T('ui.mediafetch.fetchedTitle', { n: items.filter(i=>i.status==='done').length }) }}</h3>
    <div v-for="(it, idx) in items" :key="idx" class="item-row" :class="it.status === 'error' ? 'fail' : (it.status === 'done' ? 'pass' : '')">
      <span class="badge" :class="it.status === 'error' ? 'bad' : (it.status === 'done' ? 'ok' : 'skip')">
        {{ it.status === 'error' ? T('ui.mediafetch.itemFail') : (it.status === 'done' ? T('ui.mediafetch.itemDone') : T('ui.mediafetch.itemWorking')) }}
      </span>
      <span class="item-title">{{ it.name }}</span>
      <span v-if="it.size" class="item-detail">{{ formatSize(it.size) }}</span>
      <span v-if="it.status === 'working' && it.progress" class="item-detail">{{ it.progress }}%</span>
      <button v-if="it.status === 'done'" class="btn ghost" @click="download(it)"><i class="bi bi-download"></i> {{ T('ui.common.download') }}</button>
      <pre v-if="it.error" class="err-stack">{{ it.error }}</pre>
    </div>
  </div>
</template>
