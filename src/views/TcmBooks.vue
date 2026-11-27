<script setup>
// 方书与医经库（第 7 期）阅读页：9 书 tab + 卷/篇二级目录 + Worker 全文检索。
// 与 Classics.vue 的全量库同构：索引随包内嵌、分片按需下载进 IndexedDB、检索在 Worker。
import { ref, computed, onMounted, watch } from 'vue'
import { T } from '../lib/i18n.dev.js'
import { loadIndex, fullStatus, downloadFull, removeFull, readPiece } from '../lib/tcmfull.js'
import { searchIndex } from '../lib/tcmbooksearch.js'
import { highlight, escapeHtml } from '../lib/poems.js'
import { copyText as clipboardCopy } from '../lib/clipboard.js'

const MSG = 'views.tcmBooks'

/* ---------------- 索引与书目 ---------------- */

const index = ref(null)
const loading = ref(true)
const errMsg = ref('')

const bookIdx = ref(0)
const query = ref('')
const current = ref(null) // { g, title, juan, sub }
const currentText = ref('')
const textBusy = ref(false)
const toast = ref('')
let toastTimer = null

function flash(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 1600)
}

const books = computed(() => index.value?.books || [])

onMounted(async () => {
  try {
    index.value = await loadIndex()
    await refreshFull()
    current.value = firstOfBook(0)
    await openCurrent()
  } catch (e) {
    errMsg.value = e.message || String(e)
  } finally {
    loading.value = false
  }
})

function firstOfBook(bi) {
  if (!index.value) return null
  const e = index.value.entries.find((x) => x[0] === bi)
  return e ? { g: index.value.entries.indexOf(e), title: e[3], juan: e[4], sub: e[5], shard: e[1], off: e[2] } : null
}

/* ---------------- 全量库（下载 / Worker 检索） ---------------- */

const full = ref({ installed: false, have: 0, shards: 0 })
const dl = ref({ state: 'idle', done: 0, total: 0, phase: '' }) // idle | downloading
let worker = null
let searchSeq = 0
const workerHits = ref(null)
const workerBusy = ref(false)
const titleOnly = ref(false)

function ensureWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../lib/tcmbook.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'results' && m.reqId === searchSeq) {
      workerBusy.value = false
      workerHits.value = m.hits
      titleOnly.value = !!m.titleOnly || (m.missing || 0) > 0
    } else if (m.type === 'error') {
      workerBusy.value = false
      errMsg.value = m.message || String(m)
    }
  }
  worker.onerror = () => {
    workerBusy.value = false
  }
  return worker
}

async function refreshFull() {
  const st = await fullStatus()
  full.value = st
  if (st.installed) {
    ensureWorker()
    worker.postMessage({ type: 'init' })
  }
}

async function startDownload() {
  dl.value = { state: 'downloading', done: 0, total: 1, phase: 'index' }
  try {
    await downloadFull((done, total, phase) => {
      dl.value = { state: 'downloading', done, total, phase }
    })
    dl.value.state = 'idle'
    await refreshFull()
    flash(T(`${MSG}.dlDone`))
  } catch (e) {
    dl.value.state = 'idle'
    errMsg.value = `${T(`${MSG}.dlFail`)}：${e.message || e}`
  }
}

async function removeLibrary() {
  await removeFull()
  full.value = { installed: false, have: 0, shards: 0 }
  workerHits.value = null
  currentText.value = ''
  worker?.postMessage({ type: 'dispose' })
  worker = null
}

/* ---------------- 目录树 ---------------- */

const juanOpen = ref(new Set([0]))
function toggleJuan(i) {
  const s = new Set(juanOpen.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  juanOpen.value = s
}

const bookEntries = computed(() => {
  if (!index.value) return []
  return index.value.entries.filter((e) => e[0] === bookIdx.value)
})

const groups = computed(() => {
  const arr = []
  const seen = new Map()
  for (const e of bookEntries.value) {
    const key = `${e[4]}|${e[5]}`
    if (!seen.has(key)) {
      const g = { juan: e[4], sub: e[5], items: [] }
      seen.set(key, g)
      arr.push(g)
    }
    seen.get(key).items.push(e)
  }
  return arr
})

watch(bookIdx, async () => {
  query.value = ''
  workerHits.value = null
  juanOpen.value = new Set([0])
  current.value = firstOfBook(bookIdx.value)
  await openCurrent()
})

/* ---------------- 检索 ---------------- */

// 已装库 → Worker 全文；未装库 → 纯索引标题检索。两者命中结构一致。
const results = computed(() => {
  if (!query.value.trim()) return null
  if (full.value.installed) return workerHits.value ?? []
  return searchIndex(index.value?.entries || [], query.value, bookIdx.value)
})

const list = computed(() => results.value || bookEntries.value)

watch(query, () => {
  if (!query.value.trim()) {
    workerHits.value = null
    workerBusy.value = false
    return
  }
  if (!full.value.installed) return
  workerBusy.value = true
  ensureWorker()
  worker.postMessage({ type: 'search', q: query.value, book: bookIdx.value, limit: 120, reqId: ++searchSeq })
})

// 目录条目是定长数组 [book, shard, off, title, juan, sub]；检索命中是对象
// { g, book, shard, off, title, juan, snippet }。两条来源统一按全局序号 g 回索引取值，
// 绝不直接按下标读字段——否则点检索结果会得到 shard=undefined（曾经的请求 sundefined.json.gz）。
function entryG(e) {
  return Array.isArray(e) ? index.value.entries.indexOf(e) : e.g
}

function pickEntry(e) {
  const g = entryG(e)
  const raw = index.value.entries[g]
  if (!raw) return
  current.value = { g, title: raw[3], juan: raw[4], sub: raw[5], shard: raw[1], off: raw[2] }
  openCurrent()
}

async function openCurrent() {
  if (!current.value) {
    currentText.value = ''
    return
  }
  textBusy.value = true
  try {
    const r = await readPiece(current.value.shard, current.value.off)
    currentText.value = r.text
  } catch (e) {
    currentText.value = ''
    errMsg.value = e.message || String(e)
  } finally {
    textBusy.value = false
  }
}

const metaText = computed(() => {
  const it = current.value
  if (!it) return ''
  return [it.juan, it.sub].filter((x) => x && x !== '序跋').join(' · ')
})

const listEntities = computed(() => list.value.map((e) => ({ e, g: index.value ? entryG(e) : -1 })))

function shift(step) {
  const arr = listEntities.value
  if (!arr.length || !current.value) return
  const i = arr.findIndex((x) => x.g === current.value.g)
  const j = Math.min(arr.length - 1, Math.max(0, (i < 0 ? 0 : i) + step))
  pickEntry(arr[j].e)
}

function randomPick() {
  const arr = listEntities.value.length ? listEntities.value : index.value.entries.map((e) => ({ e }))
  const x = arr[Math.floor(Math.random() * arr.length)]
  pickEntry(x.e)
}

async function copyText() {
  try {
    const it = current.value
    const head = [it.title, metaText.value].filter(Boolean).join(' · ')
    const ok = await clipboardCopy(`${head}\n\n${currentText.value}`)
    flash(T(`${MSG}.${ok ? 'copied' : 'copyFail'}`))
  } catch {
    flash(T(`${MSG}.copyFail`))
  }
}
</script>

<template>
  <h1 class="page-title">{{ T(`${MSG}.title`) }}</h1>
  <p class="page-sub">{{ T(`${MSG}.sub`) }}</p>

  <div class="disclaimer">
    <i class="bi bi-heart-pulse"></i>
    <span>{{ T(`${MSG}.disclaimer`) }}</span>
  </div>

  <div v-if="loading" class="msg info">{{ T(`${MSG}.loading`) }}</div>
  <div v-else-if="errMsg" class="msg err">
    <span>{{ T(`${MSG}.loadFail`) }}：{{ errMsg }}</span>
  </div>

  <template v-else>
    <!-- 九书 tab -->
    <div class="tabs book-tabs">
      <button v-for="(b, i) in books" :key="b.id" :class="{ active: bookIdx === i }" @click="bookIdx = i">
        <i class="bi bi-journal-text"></i>
        {{ b.name }}
        <span class="cnt">{{ b.n }}</span>
      </button>
    </div>

    <!-- 全量库状态 -->
    <div class="lib-bar" :class="{ on: full.installed }">
      <i class="bi" :class="full.installed ? 'bi-check2-circle' : 'bi-cloud-download'"></i>
      <span class="lib-text">
        {{
          full.installed
            ? T(`${MSG}.libraryOn`, { built: full.built || '' })
            : T(`${MSG}.libraryOff`)
        }}
      </span>
      <template v-if="!full.installed">
        <button v-if="dl.state !== 'downloading'" class="btn sm" @click="startDownload">
          <i class="bi bi-download"></i> {{ T(`${MSG}.dlBtn`) }}
        </button>
        <span v-else class="prog">
          <span class="bar"><span class="fill" :style="{ width: (dl.done / dl.total) * 100 + '%' }"></span></span>
          {{ T(`${MSG}.dlDoing`, { done: dl.done, total: dl.total }) }}
        </span>
      </template>
      <button v-else class="btn ghost sm" @click="removeLibrary">
        <i class="bi bi-trash"></i> {{ T(`${MSG}.removeBtn`) }}
      </button>
    </div>

    <div class="row search-row">
      <input v-model="query" class="input" :placeholder="T(`${MSG}.searchPlaceholder`)" spellcheck="false" />
      <button class="btn ghost" @click="randomPick">
        <i class="bi bi-shuffle"></i> {{ T(`${MSG}.random`) }}
      </button>
      <span class="meta-note">{{ T(`${MSG}.count`, { n: bookEntries.length }) }}</span>
    </div>
    <div v-if="query.trim()" class="hit-note">
      {{ workerBusy ? '…' : T(`${MSG}.hits`, { n: results?.length || 0 }) }}
      <span v-if="titleOnly" class="dim"> · {{ T(`${MSG}.titleOnly`) }}</span>
    </div>

    <div class="reader">
      <aside class="toc">
        <!-- 检索结果 -->
        <template v-if="results">
          <button
            v-for="e in results"
            :key="e.g"
            class="toc-item hit"
            :class="{ active: current && current.g === e.g }"
            @click="pickEntry(e)"
          >
            <span class="toc-title" v-html="highlight(e.title, query)"></span>
            <span class="toc-meta">{{ e.juan }}<template v-if="e.sub"> · {{ e.sub }}</template></span>
            <span v-if="e.snippet" class="toc-ex" v-html="highlight(e.snippet, query)"></span>
          </button>
          <div v-if="!results.length && !workerBusy" class="toc-empty">{{ T(`${MSG}.noHits`) }}</div>
        </template>

        <!-- 卷 → 篇 目录 -->
        <template v-else>
          <div v-for="(g, gi) in groups" :key="gi" class="toc-group">
            <button class="toc-group-head" :class="{ open: juanOpen.has(gi) }" @click="toggleJuan(gi)">
              <i class="bi bi-chevron-right chev"></i>
              {{ g.juan }}<span v-if="g.sub" class="dim"> · {{ g.sub }}</span>
              <span class="cnt">{{ g.items.length }}</span>
            </button>
            <div v-if="juanOpen.has(gi)" class="toc-items">
              <button
                v-for="e in g.items"
                :key="e[3] + e[2]"
                class="toc-item"
                :class="{ active: current && current.title === e[3] && current.juan === e[4] }"
                @click="pickEntry(e)"
              >
                <span class="toc-title">{{ e[3] }}</span>
              </button>
            </div>
          </div>
        </template>
      </aside>

      <section class="piece">
        <div v-if="current" class="piece-head">
          <h2 class="piece-title" v-html="query.trim() ? highlight(current.title, query) : escapeHtml(current.title)"></h2>
          <div class="piece-meta">
            <span>{{ metaText }}</span>
            <span class="dim"> · {{ books[bookIdx]?.name }}</span>
          </div>
        </div>

        <div v-if="textBusy" class="msg info">{{ T(`${MSG}.loading`) }}</div>
        <div v-else-if="currentText" class="piece-body">
          <p v-for="(p, i) in currentText.split('\n')" :key="i" v-html="highlight(p, query)"></p>
        </div>
        <div v-else class="piece empty">{{ T(`${MSG}.pickOne`) }}</div>

        <div class="piece-actions">
          <button class="btn ghost" :disabled="!currentText" @click="copyText">
            <i class="bi bi-clipboard"></i> {{ T(`${MSG}.copy`) }}
          </button>
          <span class="spacer"></span>
          <button class="btn ghost icon" :title="T(`${MSG}.prev`)" @click="shift(-1)">
            <i class="bi bi-chevron-left"></i>
          </button>
          <button class="btn ghost icon" :title="T(`${MSG}.next`)" @click="shift(1)">
            <i class="bi bi-chevron-right"></i>
          </button>
        </div>
      </section>
    </div>

    <details class="src-note">
      <summary><i class="bi bi-info-circle"></i> {{ T(`${MSG}.source`) }}</summary>
      <p>{{ T(`${MSG}.sourceBody`) }}</p>
    </details>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </template>
</template>

<style scoped>
.disclaimer {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.6;
  color: #d9a13c;
  background: rgba(217, 161, 60, 0.1);
  border: 1px solid rgba(217, 161, 60, 0.3);
  border-radius: 10px;
  padding: 9px 12px;
  margin-bottom: 14px;
}
.disclaimer i { margin-top: 2px; }

.book-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 10px;
}
.book-tabs button {
  font-size: 12.5px;
  padding: 5px 10px;
}
.cnt {
  margin-left: 5px;
  font-size: 11px;
  font-weight: 400;
  color: var(--tx2, #888);
  background: rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  padding: 1px 6px;
}

.lib-bar {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  color: var(--tx2, #666);
  background: var(--bg2, rgba(0, 0, 0, 0.03));
  border: 1px dashed var(--bd, rgba(0, 0, 0, 0.15));
  border-radius: 10px;
  padding: 9px 12px;
  margin-bottom: 12px;
}
.lib-bar.on {
  color: #3d8f5f;
  border-style: solid;
  border-color: rgba(61, 143, 95, 0.35);
  background: rgba(61, 143, 95, 0.08);
}
.lib-text { flex: 1; min-width: 0; line-height: 1.5; }
.prog { display: inline-flex; gap: 8px; align-items: center; font-size: 12.5px; }
.bar {
  display: inline-block;
  width: 90px;
  height: 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.12);
  overflow: hidden;
}
.fill { display: block; height: 100%; background: #3d8f5f; transition: width 0.2s; }

.search-row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.search-row .input { flex: 1; }
.meta-note { font-size: 12px; color: var(--tx2, #888); white-space: nowrap; }
.hit-note { font-size: 12.5px; color: #3d8f5f; margin-bottom: 8px; }
.dim { color: var(--tx2, #888); }

.reader { display: flex; gap: 14px; align-items: flex-start; }
@media (max-width: 760px) { .reader { flex-direction: column; } }

.toc {
  width: 320px;
  flex-shrink: 0;
  max-height: 66vh;
  overflow: auto;
  border: 1px solid var(--bd, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  padding: 8px;
}
@media (max-width: 760px) { .toc { width: 100%; max-height: 40vh; } }
.toc-group + .toc-group { margin-top: 3px; }
.toc-group-head {
  display: flex;
  width: 100%;
  gap: 6px;
  align-items: center;
  padding: 7px 8px;
  border: 0;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--tx, inherit);
  text-align: left;
}
.toc-group-head:hover { background: rgba(0, 0, 0, 0.05); }
.chev { transition: transform 0.15s; font-size: 12px; color: var(--tx2, #888); }
.toc-group-head.open .chev { transform: rotate(90deg); }
.toc-items { padding: 2px 4px 6px 14px; }
.toc-item {
  display: block;
  width: 100%;
  padding: 6px 9px;
  border: 0;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13.5px;
  color: var(--tx, inherit);
  text-align: left;
  line-height: 1.5;
}
.toc-item:hover { background: rgba(0, 0, 0, 0.05); }
.toc-item.active { background: rgba(61, 143, 95, 0.14); color: #2c7a4f; }
.toc-item.hit { padding-bottom: 8px; }
.toc-meta { display: block; font-size: 11.5px; color: var(--tx2, #888); }
.toc-ex { display: block; font-size: 12px; color: var(--tx2, #999); }
.toc-empty { padding: 14px 8px; font-size: 13px; color: var(--tx2, #888); text-align: center; }

.piece {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--bd, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  padding: 18px 20px;
}
.piece.empty { display: grid; place-items: center; min-height: 300px; color: var(--tx2, #888); font-size: 14px; }
.piece-title { margin: 0; font-size: 22px; line-height: 1.3; }
.piece-meta { margin-top: 5px; font-size: 13px; color: var(--tx2, #888); }
.piece-body { font-size: 14.5px; line-height: 1.85; max-height: 62vh; overflow: auto; padding-right: 6px; }
.piece-body p { margin: 0 0 6px; text-align: justify; }
.piece-actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; }
.spacer { flex: 1; }

.src-note { margin-top: 16px; font-size: 12.5px; color: var(--tx2, #888); }
.src-note summary { cursor: pointer; display: flex; gap: 6px; align-items: center; }
.src-note p { margin: 8px 0 0; line-height: 1.7; }
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(30, 30, 30, 0.88);
  color: #fff;
  font-size: 13px;
  border-radius: 10px;
  padding: 8px 16px;
  z-index: 60;
}
mark { background: rgba(255, 213, 79, 0.55); color: inherit; border-radius: 2px; padding: 0 1px; }
</style>
