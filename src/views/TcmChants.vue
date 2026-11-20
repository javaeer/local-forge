<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { T } from '../lib/i18n.dev.js'
import {
  loadChants,
  searchChants,
  highlight,
  escapeHtml,
  splitVerses,
  maskVerse,
  checkDictation,
  getRecited,
  setRecited,
  clearRecited,
} from '../lib/tcmchants.js'

/* ---------------- 加载与浏览 ---------------- */

const lib = ref(null)
const loading = ref(true)
const error = ref('')
const tab = ref('browse') // browse | recite
const bookIdx = ref(0)
const query = ref('')
const current = ref(null)
const toast = ref('')

const book = computed(() => (lib.value ? lib.value.books[bookIdx.value] : null))
const flat = computed(() => !book.value || book.value.groups.length <= 1)
const results = computed(() => (lib.value && query.value.trim() ? searchChants(lib.value, query.value, { book: bookIdx.value }) : null))
const list = computed(() => results.value || book.value?.items || [])
const groups = computed(() => {
  if (!book.value) return []
  if (results.value) return [{ name: '', items: results.value }]
  if (flat.value) return [{ name: '', items: book.value.items }]
  return book.value.groups
})

onMounted(async () => {
  try {
    lib.value = await loadChants()
    current.value = lib.value.books[0]?.items[0] || null
    refreshProgress()
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

// 韵文展示：按句分行（数据里已是长串，三字经自带换行）
const verseLines = computed(() => (current.value ? splitVerses(current.value.verse) : []))
const isSuspect = computed(() => current.value?.note?.includes('【存疑') || false)

async function copyVerse() {
  try {
    await navigator.clipboard.writeText(`${current.value.title}\n${current.value.verse}`)
    flash(T('views.tcmChants.copied'))
  } catch {
    flash(T('views.tcmChants.copyFail'))
  }
}

/* ---------------- 背诵 ---------------- */

const rBook = ref(0)
const rMode = ref('blank') // blank | first | dict
const rRatio = ref(0.5)
const rCurrent = ref(null)
const rSeed = ref(0)
const revealed = ref([]) // 被单独点开的字符 [lineIdx, chIdx]
const dictInput = ref('')
const dictResult = ref(null)

const rBooks = computed(() => lib.value?.books || [])
const rLines = computed(() => (rCurrent.value ? splitVerses(rCurrent.value.verse) : []))
const rMasked = computed(() => {
  if (!rLines.value.length || rMode.value === 'dict') return []
  return maskVerse(rLines.value, rRatio.value, rMode.value, rSeed.value)
})

function pickRandom() {
  const b = rBooks.value[rBook.value]
  if (!b?.items.length) return
  rCurrent.value = b.items[Math.floor(Math.random() * b.items.length)]
  rSeed.value = Date.now()
  revealed.value = []
  dictInput.value = ''
  dictResult.value = null
}

function startFromCurrent() {
  if (!current.value) return
  rBook.value = current.value.book
  rCurrent.value = current.value
  rSeed.value = Date.now()
  revealed.value = []
  dictInput.value = ''
  dictResult.value = null
  tab.value = 'recite'
}

watch(rBook, () => {
  // 「从本条开始背」已指定了属于该书的条目，此时不重抽
  if (!rCurrent.value || rCurrent.value.book !== rBook.value) pickRandom()
})
// 首次进入背诵 tab 时还没有题目，随机来一条
watch(tab, (t) => {
  if (t === 'recite' && !rCurrent.value) pickRandom()
})
watch(rMode, () => {
  revealed.value = []
  dictResult.value = null
})

function toggleReveal(li, ci) {
  const k = li * 1000 + ci
  const i = revealed.value.indexOf(k)
  if (i >= 0) revealed.value.splice(i, 1)
  else revealed.value.push(k)
}

function runDictCheck() {
  if (!rCurrent.value) return
  const r = checkDictation(dictInput.value, rCurrent.value.verse)
  dictResult.value = r
  if (r.score >= 0.999) setRecited(rCurrent.value.id, true)
  refreshProgress()
}

const recitedMap = ref({})
function refreshProgress() {
  recitedMap.value = getRecited()
}
const rDone = computed(() => {
  const b = rBooks.value[rBook.value]
  if (!b) return 0
  return b.items.reduce((s, it) => s + (recitedMap.value[it.id] ? 1 : 0), 0)
})
const rTotal = computed(() => rBooks.value[rBook.value]?.items.length || 0)
const rPct = computed(() => (rTotal.value ? Math.round((rDone.value / rTotal.value) * 100) : 0))
const isRecited = computed(() => rCurrent.value && !!recitedMap.value[rCurrent.value.id])

function toggleRecited() {
  if (!rCurrent.value) return
  setRecited(rCurrent.value.id, !recitedMap.value[rCurrent.value.id])
  refreshProgress()
}

function resetProgress() {
  clearRecited()
  refreshProgress()
}

let toastTimer = null
function flash(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2200)
}
</script>

<template>
  <h1 class="page-title">{{ T('views.tcmChants.title') }}</h1>
  <p class="page-sub">{{ T('views.tcmChants.sub') }}</p>

  <div class="disclaimer">
    <i class="bi bi-heart-pulse"></i>
    <span>{{ T('views.tcmChants.disclaimer') }}</span>
  </div>

  <div v-if="loading" class="msg info">{{ T('views.tcmChants.loading') }}</div>
  <div v-else-if="error" class="msg err">
    <span>{{ T('views.tcmChants.loadFail') }}：{{ error }}</span>
  </div>

  <template v-else>
    <div class="tabs">
      <button :class="{ active: tab === 'browse' }" @click="tab = 'browse'">
        <i class="bi bi-book"></i> {{ T('views.tcmChants.tabBrowse') }}
      </button>
      <button :class="{ active: tab === 'recite' }" @click="tab = 'recite'">
        <i class="bi bi-mic"></i> {{ T('views.tcmChants.tabRecite') }}
      </button>
    </div>

    <!-- 浏览 -->
    <template v-if="tab === 'browse'">
      <div class="tabs book-tabs">
        <button
          v-for="(b, i) in lib.books"
          :key="b.id"
          :class="{ active: bookIdx === i }"
          @click="bookIdx = i"
        >
          <i class="bi bi-book"></i>
          {{ b.name }}
          <span class="cnt">{{ b.n }}</span>
        </button>
      </div>

      <div class="row search-row">
        <input v-model="query" class="input" :placeholder="T('views.tcmChants.searchPlaceholder')" spellcheck="false" />
        <button class="btn ghost" @click="randomPick">
          <i class="bi bi-shuffle"></i> {{ T('views.tcmChants.random') }}
        </button>
        <button class="btn ghost" :disabled="!current" @click="startFromCurrent">
          <i class="bi bi-mic"></i> {{ T('views.tcmChants.reciteFrom') }}
        </button>
        <span v-if="book" class="meta-note">{{ book.author }}</span>
      </div>

      <div class="reader">
        <aside class="toc">
          <div v-if="query.trim()" class="toc-hit">{{ T('views.tcmChants.hits', { n: list.length }) }}</div>
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
              <i v-if="recitedMap[it.id]" class="bi bi-check2-circle ok"></i>
            </button>
          </div>
          <div v-if="!list.length" class="toc-empty">{{ T('views.tcmChants.noHits') }}</div>
        </aside>

        <section v-if="current" class="piece">
          <div class="piece-head">
            <h2 class="piece-title">{{ current.title }}</h2>
            <div class="piece-meta">
              <span v-if="current.group">{{ current.group }}</span>
              <span>· {{ book.author }}</span>
            </div>
          </div>

          <div class="piece-body">
            <p v-for="(l, i) in verseLines" :key="i">{{ l }}</p>
          </div>

          <div v-if="current.note" class="piece-note">
            <div class="note-label">
              <i class="bi bi-chat-left-quote"></i>
              {{ isSuspect ? T('views.tcmChants.mark') : T('views.tcmChants.note') }}
            </div>
            <p v-html="highlight(current.note, query)"></p>
          </div>

          <div class="piece-actions">
            <button class="btn ghost" @click="copyVerse">
              <i class="bi bi-clipboard"></i> {{ T('views.tcmChants.copy') }}
            </button>
            <span class="spacer"></span>
            <button class="btn ghost icon" :title="T('views.tcmChants.prev')" @click="shift(-1)">
              <i class="bi bi-chevron-left"></i>
            </button>
            <button class="btn ghost icon" :title="T('views.tcmChants.next')" @click="shift(1)">
              <i class="bi bi-chevron-right"></i>
            </button>
          </div>
        </section>

        <section v-else class="piece empty">{{ T('views.tcmChants.pickOne') }}</section>
      </div>

      <details class="src-note">
        <summary><i class="bi bi-info-circle"></i> {{ T('views.tcmChants.source') }}</summary>
        <p>{{ T('views.tcmChants.sourceBody') }}</p>
      </details>
    </template>

    <!-- 背诵 -->
    <template v-else>
      <div class="recite-bar">
        <label>
          {{ T('views.tcmChants.reciteBook') }}
          <select v-model.number="rBook" class="input sel">
            <option v-for="(b, i) in rBooks" :key="b.id" :value="i">{{ b.name }}（{{ b.n }}）</option>
          </select>
        </label>
        <label>
          {{ T('views.tcmChants.mode') }}
          <span class="seg">
            <button :class="{ on: rMode === 'blank' }" @click="rMode = 'blank'">{{ T('views.tcmChants.modeBlank') }}</button>
            <button :class="{ on: rMode === 'first' }" @click="rMode = 'first'">{{ T('views.tcmChants.modeFirst') }}</button>
            <button :class="{ on: rMode === 'dict' }" @click="rMode = 'dict'">{{ T('views.tcmChants.modeDict') }}</button>
          </span>
        </label>
        <label v-if="rMode === 'blank'">
          {{ T('views.tcmChants.ratio') }}
          <select v-model.number="rRatio" class="input sel">
            <option :value="0.25">25%</option>
            <option :value="0.4">40%</option>
            <option :value="0.5">50%</option>
            <option :value="0.7">70%</option>
            <option :value="1">100%</option>
          </select>
        </label>
        <span class="spacer"></span>
        <span class="prog">
          {{ T('views.tcmChants.progressOf', { done: rDone, n: rTotal }) }}
          <span class="bar"><span class="fill" :style="{ width: rPct + '%' }"></span></span>
        </span>
        <button class="btn ghost" @click="pickRandom">
          <i class="bi bi-shuffle"></i> {{ T('views.tcmChants.reciteAgain') }}
        </button>
        <button class="btn ghost icon" :title="T('views.tcmChants.unmarkRecited') + ' / ' + T('views.tcmChants.progress')" @click="resetProgress">
          <i class="bi bi-arrow-counterclockwise"></i>
        </button>
      </div>

      <p class="hint">{{ T('views.tcmChants.hintRecite') }}</p>

      <section v-if="rCurrent" class="piece recite">
        <div class="piece-head">
          <h2 class="piece-title">{{ rCurrent.title }}</h2>
          <div class="piece-meta">
            <span v-if="rCurrent.group">{{ rCurrent.group }}</span>
            <span>· {{ rBooks[rBook]?.author }}</span>
          </div>
        </div>

        <!-- 挖空 / 首字提示 -->
        <div v-if="rMode !== 'dict'" class="mask-body">
          <p v-for="(line, li) in rMasked" :key="li" class="mask-line">
            <template v-for="(c, ci) in line" :key="ci">
              <span
                v-if="c.mask && !revealed.includes(li * 1000 + ci)"
                class="masked"
                @click="toggleReveal(li, ci)"
              >●</span>
              <span v-else :class="{ revealed: c.mask }">{{ c.ch }}</span>
            </template>
          </p>
        </div>
        <div v-else class="mask-body">
          <textarea
            v-model="dictInput"
            class="input dict"
            rows="6"
            :placeholder="T('views.tcmChants.dictPlaceholder')"
            spellcheck="false"
          ></textarea>
          <div v-if="dictResult" class="dict-result">
            <p class="dict-score" :class="{ perfect: dictResult.score >= 0.999 }">
              {{ dictResult.score >= 0.999 ? T('views.tcmChants.dictPerfect') : T('views.tcmChants.dictScore', { pct: Math.round(dictResult.score * 100), hit: Math.round(dictResult.score * dictResult.marks.length), n: dictResult.marks.length }) }}
            </p>
            <p class="dict-marks">
              <span v-for="(m, i) in dictResult.marks" :key="i" :class="{ bad: !m.ok }">{{ m.ch }}</span>
            </p>
          </div>
        </div>

        <div class="piece-actions">
          <button v-if="rMode !== 'dict'" class="btn ghost" @click="rSeed = Date.now(); revealed = []">
            <i class="bi bi-arrow-repeat"></i> {{ T('views.tcmChants.reciteAgain') }}
          </button>
          <button v-if="rMode === 'dict'" class="btn" @click="runDictCheck">
            <i class="bi bi-check2-square"></i> {{ T('views.tcmChants.dictCheck') }}
          </button>
          <button v-if="rMode === 'dict'" class="btn ghost" @click="dictInput = ''; dictResult = null">
            <i class="bi bi-x-lg"></i> {{ T('views.tcmChants.dictReset') }}
          </button>
          <span class="spacer"></span>
          <button class="btn ghost" :class="{ ok: isRecited }" @click="toggleRecited">
            <i class="bi" :class="isRecited ? 'bi-check2-circle' : 'bi-circle'"></i>
            {{ isRecited ? T('views.tcmChants.recited') : T('views.tcmChants.markRecited') }}
          </button>
        </div>
      </section>

      <section v-else class="piece empty">{{ T('views.tcmChants.reciteStart') }}</section>
    </template>

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
.disclaimer i {
  margin-top: 2px;
}

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
  background: rgba(232, 149, 74, 0.14);
  border-color: rgba(232, 149, 74, 0.4);
  color: var(--accent, #38bdf8);
}
.tabs .cnt {
  font-size: 11.5px;
  padding: 0 5px;
  border-radius: 6px;
  background: rgba(120, 150, 200, 0.16);
  color: var(--faint, #6b7a96);
}
.book-tabs button.active {
  color: var(--accent, #38bdf8);
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
  align-items: center;
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
  background: rgba(232, 149, 74, 0.16);
  color: var(--accent, #38bdf8);
}
.toc-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toc-item .ok {
  color: #4ade80;
  flex: none;
}
.toc-empty {
  padding: 20px 10px;
  font-size: 13px;
  color: var(--faint, #6b7a96);
}

.piece {
  border: 1px solid var(--line, rgba(120, 150, 200, 0.18));
  border-radius: 12px;
  padding: 18px 20px;
  background: rgba(120, 150, 200, 0.04);
}
.piece.empty {
  color: var(--faint, #6b7a96);
  display: grid;
  place-items: center;
  min-height: 180px;
}
.piece-head {
  margin-bottom: 12px;
}
.piece-title {
  margin: 0;
  font-size: 20px;
  color: var(--txt, #e8edf7);
}
.piece-meta {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--faint, #6b7a96);
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.piece-body {
  font-size: 16.5px;
  line-height: 2.1;
  letter-spacing: 0.06em;
  color: var(--txt, #e8edf7);
}
.piece-body p {
  margin: 0;
}
.piece-note {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--line, rgba(120, 150, 200, 0.25));
  font-size: 13px;
  line-height: 1.8;
  color: var(--muted, #93a2bd);
}
.note-label {
  font-size: 12px;
  color: var(--faint, #6b7a96);
  margin-bottom: 4px;
}
.piece-note p {
  margin: 0;
  word-break: break-all;
}
.piece-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 16px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.btn.ok {
  color: #4ade80;
  border-color: rgba(74, 222, 128, 0.4);
}

.src-note {
  margin-top: 16px;
  font-size: 12.5px;
  color: var(--faint, #6b7a96);
}
.src-note summary {
  cursor: pointer;
}
.src-note p {
  margin: 8px 0 0;
  line-height: 1.8;
}

/* 背诵 */
.recite-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.recite-bar label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--muted, #93a2bd);
}
.recite-bar .sel {
  width: auto;
  padding: 6px 10px;
  font-size: 13px;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--line, rgba(120, 150, 200, 0.25));
  border-radius: 9px;
  overflow: hidden;
}
.seg button {
  border: 0;
  background: transparent;
  color: var(--muted, #93a2bd);
  font-size: 12.5px;
  padding: 6px 12px;
  cursor: pointer;
}
.seg button.on {
  background: rgba(232, 149, 74, 0.16);
  color: var(--accent, #38bdf8);
}
.prog {
  font-size: 12.5px;
  color: var(--muted, #93a2bd);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.bar {
  width: 90px;
  height: 6px;
  border-radius: 4px;
  background: rgba(120, 150, 200, 0.18);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  background: var(--accent, #38bdf8);
  transition: width 0.3s;
}
.hint {
  font-size: 12px;
  color: var(--faint, #6b7a96);
  margin: 0 0 12px;
}
.recite {
  max-width: 760px;
}
.mask-body {
  font-size: 17px;
  line-height: 2.3;
  letter-spacing: 0.08em;
  color: var(--txt, #e8edf7);
}
.mask-line {
  margin: 0;
}
.masked {
  display: inline-block;
  min-width: 1.1em;
  text-align: center;
  color: rgba(232, 149, 74, 0.45);
  background: rgba(232, 149, 74, 0.1);
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
}
.revealed {
  color: var(--accent, #38bdf8);
}
.dict {
  width: 100%;
  font-size: 15px;
  line-height: 1.9;
  letter-spacing: 0.05em;
  resize: vertical;
}
.dict-result {
  margin-top: 12px;
}
.dict-score {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--accent, #38bdf8);
}
.dict-score.perfect {
  color: #4ade80;
}
.dict-marks {
  margin: 0;
  font-size: 15px;
  line-height: 1.9;
  letter-spacing: 0.05em;
  word-break: break-all;
}
.dict-marks .bad {
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
  border-radius: 3px;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  background: rgba(20, 28, 44, 0.95);
  border: 1px solid var(--line, rgba(120, 150, 200, 0.3));
  color: var(--txt, #e8edf7);
  font-size: 13px;
  padding: 9px 18px;
  border-radius: 10px;
  z-index: 60;
}
</style>
