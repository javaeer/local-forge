<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import HelpTip from '../components/HelpTip.vue'
import { T } from '../lib/i18n.dev.js'
import { loadPoems, searchPoems, highlight, escapeHtml } from '../lib/poems.js'
import { CARD_SCHEMES, drawCard, cardToBlob } from '../lib/poemcard.js'
import { fullStatus, downloadFull, removeFull, loadIndexLocal, readPiece } from '../lib/poemfull.js'

const router = useRouter()

const lib = ref(null)
const loading = ref(true)
const error = ref('')
const bookIdx = ref(0)
const query = ref('')
const current = ref(null)
const toast = ref('')

// 卡片弹层
const cardOpen = ref(false)
const cardScheme = ref('xuan')
const cardSize = ref('3:4')
const cardCanvas = ref(null)
const cardBusy = ref(false)

const SIZES = {
  '3:4': { w: 1080, h: 1440 },
  '1:1': { w: 1080, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
}

const book = computed(() => (lib.value ? lib.value.books[bookIdx.value] : null))

// 单组且组名与书名无区别时（宋词三百首），目录不再套一层分组标题
const flat = computed(() => !book.value || book.value.groups.length <= 1)

const results = computed(() => (lib.value && query.value.trim() ? searchPoems(lib.value, query.value, { book: bookIdx.value }) : null))

const list = computed(() => results.value || book.value?.items || [])

// 目录分组：检索结果按书内顺序平铺，不分组（用户找的是命中项，不是体例）
const groups = computed(() => {
  if (!book.value) return []
  if (results.value) return [{ name: '', items: results.value }]
  if (flat.value) return [{ name: '', items: book.value.items }]
  return book.value.groups
})

onMounted(async () => {
  try {
    lib.value = await loadPoems()
    current.value = lib.value.books[0]?.items[0] || null
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
})

watch(bookIdx, () => {
  query.value = ''
  current.value = book.value?.items[0] || null
})

function pick(it) {
  current.value = it
}

function shift(step) {
  const arr = list.value
  if (!arr.length || !current.value) return
  const i = arr.findIndex((x) => x.id === current.value.id)
  const j = Math.min(arr.length - 1, Math.max(0, (i < 0 ? 0 : i) + step))
  current.value = arr[j]
}

function randomPick() {
  const arr = book.value?.items || []
  if (!arr.length) return
  current.value = arr[Math.floor(Math.random() * arr.length)]
  query.value = ''
}

/* ---------------- 正文渲染 ---------------- */

// 正文在数据里已按句分行（唐诗一行一联、宋词一行一句、古文一行一段）。
// 这里再按句读细分，只为阅读区分句而非硬换行——古文整段不切开会很挤。
const paragraphs = computed(() => {
  if (!current.value) return []
  return current.value.text.split('\n')
})

const isVerse = computed(() => current.value && current.value.book !== 2)

/* ---------------- 卡片 ---------------- */

const cardText = computed(() => {
  const c = current.value
  if (!c) return ''
  // 卡片上不放标题（标题另有竖排大字），
  // 古文太长，卡片只取首段，避免一屏挤成蚂蚁
  const raw = c.book === 2 ? c.text.split('\n')[0] : c.text
  return raw
})

function openCard() {
  cardOpen.value = true
  nextTick(renderCard)
}

async function renderCard() {
  if (!cardCanvas.value || !current.value) return
  const size = SIZES[cardSize.value] || SIZES['3:4']
  cardBusy.value = true
  try {
    drawCard(cardCanvas.value, {
      title: current.value.title,
      author: [current.value.dynasty, current.value.author].filter(Boolean).join(' · '),
      text: cardText.value,
      scheme: cardScheme.value,
      width: size.w,
      height: size.h,
      sealText: current.value.book === 2 ? '观止' : '读诗',
    })
  } finally {
    cardBusy.value = false
  }
}

watch([cardScheme, cardSize], () => {
  if (cardOpen.value) renderCard()
})

async function downloadCard() {
  if (!cardCanvas.value) return
  try {
    const blob = await cardToBlob(cardCanvas.value)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${current.value.title}-${cardScheme.value}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    flash(T('views.classics.cardSaved'))
  } catch (e) {
    flash(e.message)
  }
}

async function copyCard() {
  if (!cardCanvas.value) return
  try {
    const blob = await cardToBlob(cardCanvas.value)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    flash(T('views.classics.cardCopied'))
  } catch {
    flash(T('views.classics.copyFail'))
  }
}

/* ---------------- 联动格律校验 ---------------- */

const canCheck = computed(() => current.value && current.value.book !== 2)

function checkMeter() {
  if (!canCheck.value) return
  const c = current.value
  const to = c.book === 1 ? '/ci-meter' : '/poem-meter'
  router.push({ path: to, query: { text: c.text, tune: c.book === 1 ? c.title : '' } })
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(current.value.text)
    flash(T('views.classics.copied'))
  } catch {
    flash(T('views.classics.copyFail'))
  }
}

/* ---------------- 全量库（L2）：下载到本机后才可检索 ---------------- */

const FULL_BOOKS = [
  { id: 'tang', name: '全唐诗', d: '唐', icon: 'bi-book' },
  { id: 'song', name: '全宋词', d: '宋', icon: 'bi-music-note' },
  { id: 'yuan', name: '全元曲', d: '元', icon: 'bi-music-note-beamed' },
]

const tab = ref('books') // 'books' | 'full'
const full = ref({ installed: false, have: 0, shards: 0 })
const fullBooks = ref([])
const dlState = ref('idle') // idle | downloading | error
const dlProgress = ref({ done: 0, total: 0, phase: '' })
const fullQuery = ref('')
const fullBook = ref(-1)
const fullResults = ref([])
const fullSearching = ref(false)
const fullTitleOnly = ref(false)
const fullLoading = ref(false)
const fullPiece = ref(null) // 打开的单篇
const fullPieceBusy = ref(false)

let worker = null
let searchSeq = 0

function ensureWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../lib/poem.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'results') {
      fullSearching.value = false
      fullResults.value = m.hits
      fullTitleOnly.value = !!m.titleOnly || (m.missing || 0) > 0
    }
  }
  worker.onerror = () => {
    fullSearching.value = false
  }
  return worker
}

async function refreshFull() {
  const st = await fullStatus()
  full.value = st
  fullBooks.value = st.installed ? st.books : []
  if (st.installed) {
    ensureWorker()
    worker.postMessage({ type: 'init' })
  }
}

function startDownload() {
  dlState.value = 'downloading'
  dlProgress.value = { done: 0, total: 1, phase: 'index' }
  downloadFull((done, total, phase) => {
    dlProgress.value = { done, total, phase }
  })
    .then(() => {
      dlState.value = 'idle'
      return refreshFull()
    })
    .catch((e) => {
      dlState.value = 'error'
      dlProgress.value = { ...dlProgress.value, error: e.message || String(e) }
    })
}

function deleteFull() {
  removeFull().then(() => {
    full.value = { installed: false, have: 0, shards: 0 }
    fullBooks.value = []
    fullResults.value = []
    fullPiece.value = null
    worker?.postMessage({ type: 'dispose' })
    worker = null
    flash(T('views.classics.fullRemoved'))
  })
}

function runFullSearch() {
  const q = fullQuery.value.trim()
  if (!q || !full.value.installed) return
  const w = ensureWorker()
  fullSearching.value = true
  w.postMessage({ type: 'search', q, book: fullBook.value, limit: 120, reqId: ++searchSeq })
}

// 打开一篇全量作品：正文直接从 IndexedDB / 网络读，填进右侧阅读区
async function openFullPiece(hit) {
  fullPieceBusy.value = true
  try {
    const it = await readPiece(hit.shard, hit.off)
    fullPiece.value = { ...it, g: hit.g, book: hit.book, dynasty: FULL_BOOKS[hit.book]?.d || '' }
  } catch (e) {
    flash(e.message)
  } finally {
    fullPieceBusy.value = false
  }
}

// 全量作品送格律校验：唐→近体诗，宋→词牌；元曲没有对应谱，不给入口
function checkFullMeter() {
  const p = fullPiece.value
  if (!p || p.book > 1) return
  const to = p.book === 1 ? '/ci-meter' : '/poem-meter'
  router.push({ path: to, query: { text: p.text, tune: p.book === 1 ? p.title : '' } })
}

onMounted(refreshFull)

const fullTotal = computed(() => (fullBooks.value || []).reduce((a, b) => a + (b.n || 0), 0))
const dlDone = computed(() => dlProgress.value.done)
const dlTotal = computed(() => dlProgress.value.total)
const dlPct = computed(() => (dlTotal.value ? Math.round((dlDone.value / dlTotal.value) * 100) + '%' : '0%'))
const dlError = computed(() => dlProgress.value.error || '')

async function copyFullPiece() {
  try {
    await navigator.clipboard.writeText(fullPiece.value.text)
    flash(T('views.classics.copied'))
  } catch {
    flash(T('views.classics.copyFail'))
  }
}

let toastTimer = null
function flash(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2200)
}
</script>

<template>
  <h1 class="page-title">{{ T('views.classics.title') }}</h1>
  <p class="page-sub">{{ T('views.classics.sub') }}</p>

  <HelpTip :title="T('views.classics.legendTitle')" icon="bi-journal-bookmark">
    <p class="legend-body" style="margin:0">{{ T('views.classics.legendBody') }}</p>
  </HelpTip>

  <div v-if="loading" class="msg info">{{ T('views.classics.loading') }}</div>
  <div v-else-if="error" class="msg err">
    <span>{{ T('views.classics.loadFail') }}：{{ error }}</span>
  </div>

  <template v-else>
    <div class="tabs wrap-tabs">
      <button
        v-for="(b, i) in lib.books"
        :key="b.id"
        :class="{ active: tab === 'books' && bookIdx === i }"
        @click="tab = 'books'; bookIdx = i"
      >
        <i class="bi" :class="i === 2 ? 'bi-journal-text' : 'bi-book'"></i>
        {{ b.name }}
        <span class="cnt">{{ b.n }}</span>
      </button>
      <span class="tab-sep"></span>
      <button :class="{ active: tab === 'full' }" @click="tab = 'full'; refreshFull()">
        <i class="bi bi-cloud-download"></i> {{ T('views.classics.fullTab') }}
        <span v-if="full.installed" class="cnt">{{ fullTotal }}</span>
      </button>
    </div>

    <!-- 精选（L1） -->
    <template v-if="tab === 'books'">
    <div class="row search-row">
      <input
        v-model="query"
        class="input"
        :placeholder="T('views.classics.searchPlaceholder')"
        spellcheck="false"
      />
      <button class="btn ghost" @click="randomPick">
        <i class="bi bi-shuffle"></i> {{ T('views.classics.random') }}
      </button>
      <span v-if="book" class="meta-note">{{ book.note }}</span>
    </div>

    <div class="reader">
      <aside class="toc">
        <div v-if="query.trim()" class="toc-hit">
          {{ T('views.classics.hits', { n: list.length }) }}
        </div>
        <div v-for="g in groups" :key="g.name" class="toc-group">
          <div v-if="g.name" class="toc-group-name">{{ g.name }}</div>
          <button
            v-for="it in g.items"
            :key="it.id"
            class="toc-item"
            :class="{ active: current && current.id === it.id }"
            @click="pick(it)"
          >
            <span class="toc-title" v-html="query.trim() ? highlight(it.title, query) : escapeHtml(it.title)"></span>
            <span class="toc-author">{{ it.author }}</span>
          </button>
        </div>
        <div v-if="!list.length" class="toc-empty">{{ T('views.classics.noHits') }}</div>
      </aside>

      <section v-if="current" class="piece">
        <div class="piece-head">
          <h2 class="piece-title">{{ current.title }}</h2>
          <div class="piece-meta">
            <span v-if="current.dynasty">{{ current.dynasty }}</span>
            <span v-if="current.author">· {{ current.author }}</span>
            <span v-if="current.source" class="src">《{{ current.source }}》</span>
            <span class="chars">{{ T('views.classics.chars', { n: current.chars }) }}</span>
          </div>
        </div>

        <div class="piece-body" :class="{ verse: isVerse }">
          <p v-for="(p, i) in paragraphs" :key="i">{{ p }}</p>
        </div>

        <div class="piece-actions">
          <button class="btn" @click="openCard">
            <i class="bi bi-image"></i> {{ T('views.classics.card') }}
          </button>
          <button v-if="canCheck" class="btn ghost" @click="checkMeter">
            <i class="bi bi-rulers"></i>
            {{ current.book === 1 ? T('views.classics.checkCi') : T('views.classics.checkPoem') }}
          </button>
          <button class="btn ghost" @click="copyText">
            <i class="bi bi-clipboard"></i> {{ T('views.classics.copy') }}
          </button>
          <span class="spacer"></span>
          <button class="btn ghost icon" :title="T('views.classics.prev')" @click="shift(-1)">
            <i class="bi bi-chevron-left"></i>
          </button>
          <button class="btn ghost icon" :title="T('views.classics.next')" @click="shift(1)">
            <i class="bi bi-chevron-right"></i>
          </button>
        </div>
      </section>

      <section v-else class="piece empty">{{ T('views.classics.pickOne') }}</section>
    </div>
    </template>

    <!-- 全量库（L2）：主动下载 → IndexedDB → Worker 检索 -->
    <template v-else>
      <div v-if="!full.installed" class="full-off">
        <i class="bi bi-cloud-arrow-down big-icon"></i>
        <h3>{{ T('views.classics.fullTitle') }}</h3>
        <p class="full-desc">{{ T('views.classics.fullDesc') }}</p>
        <button class="btn" :disabled="dlState === 'downloading'" @click="startDownload">
          <i class="bi bi-download"></i> {{ T('views.classics.fullDownload') }}
        </button>
        <div v-if="dlState === 'downloading'" class="dl-progress">
          <div class="dl-bar"><i :style="{ width: dlPct }"></i></div>
          <span class="mono">{{ dlDone }} / {{ dlTotal }}</span>
        </div>
        <div v-else-if="dlState === 'error'" class="msg err">{{ dlError }}</div>
        <p class="full-foot">{{ T('views.classics.fullFoot') }}</p>
      </div>

      <template v-else>
        <div class="row search-row">
          <select v-model="fullBook" class="input select" @change="runFullSearch()">
            <option :value="-1">{{ T('views.classics.allBooks') }}</option>
            <option v-for="(b, i) in fullBooks" :key="b.id" :value="i">{{ b.name }} · {{ b.n }}</option>
          </select>
          <input
            v-model="fullQuery"
            class="input"
            :placeholder="T('views.classics.fullSearchPlaceholder')"
            spellcheck="false"
            @keyup.enter="runFullSearch()"
          />
          <button class="btn" :disabled="!fullQuery.trim()" @click="runFullSearch()">
            <i class="bi bi-search"></i> {{ T('views.classics.fullSearch') }}
          </button>
          <span class="spacer"></span>
          <button class="btn ghost danger" @click="deleteFull">
            <i class="bi bi-trash3"></i> {{ T('views.classics.fullDelete') }}
          </button>
        </div>

        <div v-if="fullTitleOnly" class="msg info">{{ T('views.classics.fullTitleOnly') }}</div>
        <div v-else-if="fullSearching" class="msg info">{{ T('views.classics.fullSearching') }}</div>

        <div class="full-list">
          <button v-for="h in fullResults" :key="h.g" class="full-hit" @click="openFullPiece(h)">
            <span class="fh-head">
              <b>{{ h.title }}</b>
              <span class="fh-author">{{ FULL_BOOKS[h.book]?.d }} · {{ h.author }}</span>
            </span>
            <span v-if="h.snippet" class="fh-snippet" v-html="highlight(h.snippet, fullQuery)"></span>
          </button>
          <div v-if="!fullResults.length && !fullSearching && fullQuery.trim()" class="toc-empty full-empty">
            {{ T('views.classics.noHits') }}
          </div>
          <div v-if="!fullQuery.trim()" class="toc-empty full-empty">{{ T('views.classics.fullStartHint') }}</div>
        </div>

        <div v-if="fullPiece" class="piece full-piece">
          <div class="piece-head">
            <h2 class="piece-title">{{ fullPiece.title }}</h2>
            <div class="piece-meta">
              <span>{{ fullPiece.dynasty }}</span>
              <span v-if="fullPiece.author">· {{ fullPiece.author }}</span>
              <span class="chars">{{ T('views.classics.chars', { n: fullPiece.text.length }) }}</span>
            </div>
          </div>
          <div class="piece-body verse">
            <p v-for="(para, i) in fullPiece.text.split('\n')" :key="i">{{ para }}</p>
          </div>
          <div class="piece-actions">
            <button v-if="fullPiece.book <= 1" class="btn" @click="checkFullMeter">
              <i class="bi bi-rulers"></i>
              {{ fullPiece.book === 1 ? T('views.classics.checkCi') : T('views.classics.checkPoem') }}
            </button>
            <button class="btn ghost" @click="copyFullPiece">
              <i class="bi bi-clipboard"></i> {{ T('views.classics.copy') }}
            </button>
            <span class="spacer"></span>
            <button class="btn ghost icon" @click="fullPiece = null">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
        </div>
      </template>
    </template>
  </template>

  <!-- 卡片弹层 -->
  <div v-if="cardOpen" class="modal-mask" @click.self="cardOpen = false">
    <div class="modal">
      <div class="modal-head">
        <b>{{ T('views.classics.cardTitle') }}</b>
        <button class="btn ghost icon" @click="cardOpen = false"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="card-stage">
        <canvas ref="cardCanvas" class="card-canvas"></canvas>
      </div>
      <div class="modal-controls">
        <span class="ctl-label">{{ T('views.classics.scheme') }}</span>
        <button
          v-for="s in CARD_SCHEMES"
          :key="s.id"
          class="chip scheme"
          :class="{ active: cardScheme === s.id }"
          :style="{ background: s.bg, color: s.fg, borderColor: s.line }"
          @click="cardScheme = s.id"
        >
          {{ s.name }}
        </button>
        <span class="ctl-label">{{ T('views.classics.size') }}</span>
        <button
          v-for="(v, k) in SIZES"
          :key="k"
          class="chip"
          :class="{ active: cardSize === k }"
          @click="cardSize = k"
        >
          {{ k }}
        </button>
      </div>
      <div class="modal-foot">
        <button class="btn" :disabled="cardBusy" @click="downloadCard">
          <i class="bi bi-download"></i> {{ T('views.classics.saveCard') }}
        </button>
        <button class="btn ghost" :disabled="cardBusy" @click="copyCard">
          <i class="bi bi-clipboard-image"></i> {{ T('views.classics.copyCard') }}
        </button>
      </div>
      <p class="modal-hint">{{ T('views.classics.cardHint') }}</p>
    </div>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13.5px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid var(--line, rgba(120, 150, 200, 0.18));
  background: transparent;
  color: var(--muted, #93a2bd);
  cursor: pointer;
}
.tabs button.active {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.4);
  color: var(--accent, #38bdf8);
}
.tabs .cnt {
  font-size: 11.5px;
  padding: 0 5px;
  border-radius: 6px;
  background: rgba(120, 150, 200, 0.16);
  color: var(--faint, #6b7a96);
}

.search-row {
  margin-bottom: 14px;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.search-row .input {
  flex: 1 1 260px;
  min-width: 200px;
}
.meta-note {
  font-size: 12.5px;
  color: var(--faint, #6b7a96);
}

.reader {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .reader {
    grid-template-columns: 1fr;
  }
  .toc {
    max-height: 240px;
  }
}

.toc {
  border: 1px solid var(--line, rgba(120, 150, 200, 0.18));
  border-radius: 12px;
  padding: 8px;
  max-height: 72vh;
  overflow: auto;
  background: rgba(120, 150, 200, 0.04);
}
.toc-hit {
  font-size: 12px;
  color: var(--faint, #6b7a96);
  padding: 4px 8px 8px;
}
.toc-group-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent, #38bdf8);
  padding: 10px 8px 6px;
  letter-spacing: 0.04em;
}
.toc-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 6px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--txt, #e8edf7);
  font-size: 13px;
  cursor: pointer;
  line-height: 1.5;
}
.toc-item:hover {
  background: rgba(120, 150, 200, 0.1);
}
.toc-item.active {
  background: rgba(56, 189, 248, 0.16);
  color: var(--accent, #38bdf8);
}
.toc-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toc-author {
  flex: none;
  font-size: 11.5px;
  color: var(--faint, #6b7a96);
}
.toc-empty {
  padding: 20px 10px;
  font-size: 13px;
  color: var(--faint, #6b7a96);
}

.piece {
  border: 1px solid var(--line, rgba(120, 150, 200, 0.18));
  border-radius: 12px;
  padding: 22px 24px 16px;
  background: rgba(120, 150, 200, 0.04);
  min-height: 320px;
}
.piece.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--faint, #6b7a96);
  font-size: 13px;
}
.piece-title {
  font-family: var(--serif, 'Noto Serif SC', serif);
  font-size: 24px;
  margin: 0 0 8px;
  color: var(--txt, #e8edf7);
  letter-spacing: 0.03em;
}
.piece-meta {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  align-items: baseline;
  font-size: 13px;
  color: var(--muted, #93a2bd);
  margin-bottom: 16px;
}
.piece-meta .src {
  color: var(--faint, #6b7a96);
}
.piece-meta .chars {
  margin-left: auto;
  font-size: 12px;
  color: var(--faint, #6b7a96);
}
.piece-body {
  font-family: var(--serif, 'Noto Serif SC', serif);
  font-size: 16.5px;
  line-height: 2.1;
  color: var(--txt, #e8edf7);
  padding-bottom: 14px;
}
.piece-body p {
  margin: 0 0 2px;
}
.piece-body.verse p {
  text-indent: 0;
  letter-spacing: 0.04em;
}

.piece-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  border-top: 1px solid var(--line, rgba(120, 150, 200, 0.14));
  padding-top: 12px;
}
.piece-actions .spacer {
  flex: 1;
}
.btn.icon {
  padding: 6px 10px;
}

/* 弹层 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(8, 12, 20, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 18px;
}
.modal {
  width: min(560px, 100%);
  max-height: 92vh;
  overflow: auto;
  background: var(--bg-elev, #141c2b);
  border: 1px solid var(--line, rgba(120, 150, 200, 0.2));
  border-radius: 14px;
  padding: 16px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  color: var(--txt, #e8edf7);
  font-size: 14px;
}
.card-stage {
  display: flex;
  justify-content: center;
  background: rgba(0, 0, 0, 0.24);
  border-radius: 10px;
  padding: 10px;
}
.card-canvas {
  max-width: 100%;
  max-height: 52vh;
  width: auto;
  height: auto;
  border-radius: 6px;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
}
.modal-controls {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  margin: 12px 0 6px;
}
.ctl-label {
  font-size: 12px;
  color: var(--faint, #6b7a96);
  margin-right: 2px;
}
.chip.scheme {
  border-width: 1px;
  border-style: solid;
}
.chip.active {
  outline: 2px solid var(--accent, #38bdf8);
  outline-offset: 1px;
}
.modal-foot {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.modal-hint {
  font-size: 12px;
  line-height: 1.7;
  color: var(--faint, #6b7a96);
  margin: 10px 0 0;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  background: rgba(20, 28, 43, 0.96);
  border: 1px solid var(--line, rgba(120, 150, 200, 0.24));
  color: var(--txt, #e8edf7);
  font-size: 13px;
  padding: 9px 16px;
  border-radius: 10px;
  z-index: 80;
}
mark {
  background: rgba(251, 191, 36, 0.3);
  color: inherit;
  border-radius: 3px;
}

/* 主 tab 分隔与全量库 */
.tab-sep {
  width: 1px;
  height: 22px;
  background: var(--line, rgba(120, 150, 200, 0.22));
  margin: 0 4px;
  align-self: center;
}
.full-off {
  border: 1px dashed var(--line, rgba(120, 150, 200, 0.24));
  border-radius: 14px;
  padding: 36px 24px;
  text-align: center;
  max-width: 560px;
  margin: 0 auto;
}
.big-icon {
  font-size: 40px;
  color: var(--accent, #38bdf8);
}
.full-off h3 {
  margin: 12px 0 6px;
  font-size: 17px;
  color: var(--txt, #e8edf7);
}
.full-desc {
  font-size: 13px;
  line-height: 1.8;
  color: var(--muted, #93a2bd);
  margin: 0 auto 16px;
  max-width: 44ch;
}
.full-foot {
  font-size: 12px;
  color: var(--faint, #6b7a96);
  margin: 14px 0 0;
}
.dl-progress {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
}
.dl-bar {
  width: 220px;
  height: 8px;
  border-radius: 6px;
  background: rgba(120, 150, 200, 0.16);
  overflow: hidden;
}
.dl-bar i {
  display: block;
  height: 100%;
  background: var(--accent, #38bdf8);
  transition: width 0.2s;
}
.select {
  flex: 0 0 150px;
  width: auto;
}
.full-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 14px 0;
}
.full-hit {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  padding: 11px 14px;
  border: 1px solid var(--line, rgba(120, 150, 200, 0.16));
  border-radius: 10px;
  background: rgba(120, 150, 200, 0.04);
  color: var(--txt, #e8edf7);
  cursor: pointer;
  font-size: 13.5px;
}
.full-hit:hover {
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.07);
}
.fh-head {
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.fh-head b {
  font-family: var(--serif, 'Noto Serif SC', serif);
  font-size: 14.5px;
}
.fh-author {
  font-size: 12px;
  color: var(--faint, #6b7a96);
}
.fh-snippet {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--muted, #93a2bd);
}
.full-empty {
  padding: 26px 10px;
  text-align: center;
}
.full-piece {
  margin-top: 4px;
}
.btn.danger {
  color: #fb7185;
}
</style>
