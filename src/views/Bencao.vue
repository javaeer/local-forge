<script setup>
// 《本草纲目》阅读页：部→卷→条目录树 + 主治/全文检索 + 条内分节导航。
// 索引（内嵌 107KB）始终可用；全量库（2.19MB）按需下载进 IndexedDB，
// 未装库时条目只显示主治摘要——与 Classics.vue 的 L2 全量库同一交互范式。
import { ref, computed, onMounted } from 'vue'
import { T } from '../lib/i18n.dev.js'
import { loadIndex, searchIndex, searchFull, fullStatus, downloadFull, removeFull, readFull, splitSections } from '../lib/bencao.js'
import { highlight, escapeHtml } from '../lib/poems.js'

const MSG = 'views.bencao'

/* ---------------- 数据加载 ---------------- */

const idx = ref(null)
const loading = ref(true)
const error = ref('')

// 全量库状态
const full = ref({ installed: false })
const dl = ref({ state: 'idle', pct: 0 }) // idle | downloading | done
const fullItems = ref(null) // 已装库的正文数组 [{ id, name, body, excerpt }]
const bodyMap = computed(() => {
  const m = new Map()
  for (const it of fullItems.value || []) m.set(it.id, it.body)
  return m
})

onMounted(async () => {
  try {
    idx.value = await loadIndex()
    const st = await fullStatus()
    full.value = st
    if (st.installed) fullItems.value = (await readFull()) || null
    current.value = idx.value.items[0]
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
})

async function startDownload() {
  dl.value = { state: 'downloading', pct: 0 }
  try {
    fullItems.value = await downloadFull((loaded, total, phase) => {
      if (phase === 'download' && total) dl.value.pct = Math.round((loaded / total) * 100)
    })
    dl.value.state = 'done'
    full.value = await fullStatus()
  } catch (e) {
    dl.value = { state: 'idle', pct: 0 }
    error.value = `${T(`${MSG}.dlFail`)}：${e.message || e}`
  }
}

async function removeLibrary() {
  await removeFull()
  fullItems.value = null
  full.value = { installed: false }
  dl.value = { state: 'idle', pct: 0 }
}

/* ---------------- 目录树 ---------------- */

const buOpen = ref(new Set([0])) // 默认展开第一个组（序例）
const current = ref(null)
const query = ref('')

function toggleBu(i) {
  const s = new Set(buOpen.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  buOpen.value = s
}

function pick(it) {
  current.value = it
  // 保证选中条目的部已展开
  const bi = idx.value.tree.findIndex((b) => b.bu === it.bu)
  if (bi >= 0 && !buOpen.value.has(bi)) toggleBu(bi)
}

/* ---------------- 检索 ---------------- */

const results = computed(() => {
  const q = query.value.trim()
  if (!q || !idx.value) return null
  if (fullItems.value) return searchFull(fullItems.value, q)
  return searchIndex(idx.value, q)
})

const hitCount = computed(() => (results.value ? results.value.length : 0))

const listItems = computed(() => {
  if (results.value) return results.value
  const arr = []
  for (const b of idx.value.tree) for (const g of b.juans) for (const it of g.items) arr.push(it)
  return arr
})

/* ---------------- 阅读面板 ---------------- */

const currentFull = computed(() => {
  if (!current.value) return null
  const body = bodyMap.value.get(current.value.id)
  return { ...current.value, body }
})

const parsed = computed(() => (currentFull.value?.body ? splitSections(currentFull.value.body) : null))
const hasBody = computed(() => !!currentFull.value?.body)

const metaText = computed(() => {
  const it = currentFull.value
  if (!it) return ''
  const parts = [it.bu, it.juan]
  if (it.sub) parts.push(it.sub)
  return parts.filter((x) => x && x !== '序例').join(' · ')
})

const secEls = ref([])
function scrollToSec(i) {
  secEls.value[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const bodyText = computed(() => {
  const it = currentFull.value
  if (!it?.body) return ''
  return it.body
})

function shift(step) {
  const arr = listItems.value
  if (!arr.length || !current.value) return
  const i = arr.findIndex((x) => x.id === current.value.id)
  const j = Math.min(arr.length - 1, Math.max(0, (i < 0 ? 0 : i) + step))
  current.value = arr[j]
}

function randomPick() {
  const arr = listItems.value.length ? listItems.value : idx.value.items
  current.value = arr[Math.floor(Math.random() * arr.length)]
  query.value = ''
}

async function copyEntry() {
  try {
    const it = currentFull.value
    const head = [it.name, it.bu, it.juan, it.sub].filter(Boolean).join(' · ')
    await navigator.clipboard.writeText(`${head}\n\n${it.body || it.excerpt}`)
    flash(T(`${MSG}.copied`))
  } catch {
    flash(T(`${MSG}.copyFail`))
  }
}

const toast = ref('')
let toastTimer = null
function flash(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 1600)
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
  <div v-else-if="error" class="msg err">
    <span>{{ T(`${MSG}.loadFail`) }}：{{ error }}</span>
  </div>

  <template v-else>
    <!-- 全量库状态条 -->
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
        <template v-if="dl.state !== 'downloading'">
          <button class="btn sm" @click="startDownload">
            <i class="bi bi-download"></i> {{ T(`${MSG}.dlBtn`) }}
          </button>
        </template>
        <template v-else>
          <span class="prog"><span class="bar"><span class="fill" :style="{ width: dl.pct + '%' }"></span></span>{{ T(`${MSG}.dlDoing`, { pct: dl.pct }) }}</span>
        </template>
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
      <span class="meta-note">{{ T(`${MSG}.count`, { n: idx.items.length }) }}</span>
    </div>
    <div v-if="query.trim()" class="hit-note">
      {{ T(`${MSG}.hits`, { n: hitCount }) }}
      <span v-if="!full.installed && hitCount" class="dim"> · {{ T(`${MSG}.excerptNote`) }}</span>
    </div>

    <div class="reader">
      <aside class="toc">
        <!-- 检索结果 -->
        <template v-if="results">
          <div v-for="it in results.slice(0, 200)" :key="it.id" class="toc-item hit" :class="{ active: current && current.id === it.id }" @click="pick(it)">
            <span class="toc-title" v-html="highlight(it.name, query)"></span>
            <span class="toc-meta">{{ it.bu }} · {{ it.juan }}</span>
            <span class="toc-ex" v-html="highlight((it.excerpt || '').slice(0, 48), query)"></span>
          </div>
          <div v-if="!results.length" class="toc-empty">{{ T(`${MSG}.noHits`) }}</div>
        </template>

        <!-- 部卷树 -->
        <template v-else>
          <div v-for="(b, bi) in idx.tree" :key="b.bu" class="toc-bu">
            <button class="toc-bu-head" :class="{ open: buOpen.has(bi) }" @click="toggleBu(bi)">
              <i class="bi bi-chevron-right chev"></i>
              {{ b.bu }}
              <span class="cnt">{{ b.count }}</span>
            </button>
            <div v-if="buOpen.has(bi)" class="toc-juans">
              <div v-for="g in b.juans" :key="g.juan" class="toc-juan">
                <div v-if="g.juan !== '序例'" class="toc-juan-name">
                  {{ g.juan }}<span v-if="g.sub" class="dim"> · {{ g.sub }}</span>
                </div>
                <button
                  v-for="it in g.items"
                  :key="it.id"
                  class="toc-item"
                  :class="{ active: current && current.id === it.id }"
                  @click="pick(it)"
                >
                  <span class="toc-title">{{ it.name }}</span>
                </button>
              </div>
            </div>
          </div>
        </template>
      </aside>

      <section v-if="currentFull" class="piece">
        <div class="piece-head">
          <h2 class="piece-title" v-html="query.trim() ? highlight(currentFull.name, query) : escapeHtml(currentFull.name)"></h2>
          <div class="piece-meta">
            <span>{{ metaText }}</span>
            <span v-if="parsed?.origin" class="dim"> · {{ parsed.origin }}</span>
          </div>
        </div>

        <!-- 分节导航 -->
        <div v-if="hasBody && parsed.sections.length > 1" class="sec-nav">
          <button v-for="(s, i) in parsed.sections" :key="i" class="sec-chip" @click="scrollToSec(i)">
            {{ s.tag || '·' }}
          </button>
        </div>

        <!-- 全文（已装库） -->
        <div v-if="hasBody" class="piece-body">
          <div v-for="(s, i) in parsed.sections" :key="i" :ref="(el) => (secEls[i] = el)" class="sec-block">
            <div v-if="s.tag" class="sec-tag">【{{ s.tag }}】</div>
            <p v-for="(p, j) in s.text.split('\n')" :key="j" v-html="highlight(p, query)"></p>
          </div>
        </div>

        <!-- 未装库：仅摘要 -->
        <div v-else class="piece-body excerpt-only">
          <p>{{ currentFull.excerpt }}</p>
          <div class="need-full">
            <i class="bi bi-info-circle"></i>
            <span>{{ T(`${MSG}.excerptNote`) }}</span>
            <button v-if="!full.installed && dl.state !== 'downloading'" class="btn sm" @click="startDownload">
              <i class="bi bi-download"></i> {{ T(`${MSG}.gotoDl`) }}
            </button>
          </div>
        </div>

        <div class="piece-actions">
          <button class="btn ghost" :disabled="!hasBody" @click="copyEntry">
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

      <section v-else class="piece empty">{{ T(`${MSG}.pickOne`) }}</section>
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
.disclaimer i {
  margin-top: 2px;
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
.lib-text {
  flex: 1;
  min-width: 0;
  line-height: 1.5;
}
.prog {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 12.5px;
}
.bar {
  display: inline-block;
  width: 90px;
  height: 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.12);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  background: #3d8f5f;
  transition: width 0.2s;
}

.search-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}
.search-row .input {
  flex: 1;
}
.meta-note {
  font-size: 12px;
  color: var(--tx2, #888);
  white-space: nowrap;
}
.hit-note {
  font-size: 12.5px;
  color: #3d8f5f;
  margin-bottom: 8px;
}
.dim {
  color: var(--tx2, #888);
}

.reader {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
@media (max-width: 760px) {
  .reader {
    flex-direction: column;
  }
}

.toc {
  width: 300px;
  flex-shrink: 0;
  max-height: 66vh;
  overflow: auto;
  border: 1px solid var(--bd, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  padding: 8px;
}
@media (max-width: 760px) {
  .toc {
    width: 100%;
    max-height: 40vh;
  }
}
.toc-bu + .toc-bu {
  margin-top: 2px;
}
.toc-bu-head {
  display: flex;
  width: 100%;
  gap: 6px;
  align-items: center;
  padding: 7px 8px;
  border: 0;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: var(--tx, inherit);
  text-align: left;
}
.toc-bu-head:hover {
  background: rgba(0, 0, 0, 0.05);
}
.chev {
  transition: transform 0.15s;
  font-size: 12px;
  color: var(--tx2, #888);
}
.toc-bu-head.open .chev {
  transform: rotate(90deg);
}
.cnt {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 400;
  color: var(--tx2, #888);
  background: rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  padding: 1px 7px;
}
.toc-juans {
  padding: 2px 4px 6px 14px;
}
.toc-juan + .toc-juan {
  margin-top: 6px;
}
.toc-juan-name {
  font-size: 12px;
  color: var(--tx2, #888);
  padding: 3px 8px;
}
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
.toc-item:hover {
  background: rgba(0, 0, 0, 0.05);
}
.toc-item.active {
  background: rgba(61, 143, 95, 0.14);
  color: #2c7a4f;
}
.toc-item.hit {
  padding-bottom: 8px;
}
.toc-meta {
  display: block;
  font-size: 11.5px;
  color: var(--tx2, #888);
}
.toc-ex {
  display: block;
  font-size: 12px;
  color: var(--tx2, #999);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toc-empty {
  padding: 14px 8px;
  font-size: 13px;
  color: var(--tx2, #888);
  text-align: center;
}

.piece {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--bd, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  padding: 18px 20px;
}
.piece.empty {
  display: grid;
  place-items: center;
  min-height: 300px;
  color: var(--tx2, #888);
  font-size: 14px;
}
.piece-head {
  margin-bottom: 10px;
}
.piece-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.3;
}
.piece-meta {
  margin-top: 5px;
  font-size: 13px;
  color: var(--tx2, #888);
}

.sec-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.sec-chip {
  border: 1px solid var(--bd, rgba(0, 0, 0, 0.15));
  background: transparent;
  border-radius: 14px;
  padding: 2px 10px;
  font-size: 12.5px;
  cursor: pointer;
  color: var(--tx, inherit);
}
.sec-chip:hover {
  background: rgba(0, 0, 0, 0.05);
}

.piece-body {
  font-size: 14.5px;
  line-height: 1.85;
  max-height: 62vh;
  overflow: auto;
  padding-right: 6px;
}
.sec-block {
  margin-bottom: 14px;
  scroll-margin-top: 10px;
}
.sec-tag {
  font-weight: 700;
  font-size: 14px;
  color: #2c7a4f;
  margin-bottom: 4px;
}
.piece-body p {
  margin: 0 0 6px;
  text-align: justify;
}
.excerpt-only .need-full {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--bd, rgba(0, 0, 0, 0.15));
  font-size: 13px;
  color: var(--tx2, #888);
}

.piece-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 14px;
}
.spacer {
  flex: 1;
}

.src-note {
  margin-top: 16px;
  font-size: 12.5px;
  color: var(--tx2, #888);
}
.src-note summary {
  cursor: pointer;
  display: flex;
  gap: 6px;
  align-items: center;
}
.src-note p {
  margin: 8px 0 0;
  line-height: 1.7;
}

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

mark {
  background: rgba(255, 213, 79, 0.55);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
</style>
