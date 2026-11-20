<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import DropZone from '../components/DropZone.vue'
import HelpTip from '../components/HelpTip.vue'
// 内核不进主线程：装载 / 建索引 / 检索都在后台线程，见 dictclient.js
import { loadDict, dictSearch, MODES } from '../lib/dictclient.js'
import { saveLexicon, listLexicons, deleteLexicon } from '../lib/dictstore.js'
import { precacheCores, coreStatus, swSupported } from '../lib/offline.js'
import { pushToast } from '../lib/toast.js'

/* ---------------- 状态 ---------------- */
const loading = ref(false)
const error = ref('')
const info = ref({ entries: 0, words: 0, ipaWords: 0 })
const thread = ref('') // worker=后台线程 / main=降级主线程
const sourceName = ref('')
const buildMs = ref(0)
const ipaTexts = ref(null) // { us, uk } 原始音标文本（装载后保留，换词库时复用）
const query = ref('')
const mode = ref('auto')
const res = ref(null)
const suggest = ref([]) // 空结果时的"你是不是想找"候选（自动跑一次模糊纠错）
const suggestBusy = ref(false)
const openIdx = ref(-1)
const saved = ref([]) // 本机持久化的自定义词库
const savedPersisted = ref(true)

const MODE_LABEL = {
  auto: '自动（汉字 / 拼音 / 首字母）',
  exact: '精确匹配',
  prefix: '前缀扩展',
  pinyin: '拼音检索',
  gloss: '英文释义反查',
  fuzzy: '模糊纠错（编辑距离 ≤ 2）',
}
const HIT_LABEL = {
  exact: '精确', prefix: '前缀', pinyin: '拼音', initials: '首字母', gloss: '释义', fuzzy: '模糊',
}

/* 内置词库源：同一套索引/检索管道，按需切换 */
const BUILTIN_SOURCES = {
  cedict: { id: 'cedict', file: 'dict/cc-cedict.txt.gz', name: 'CC-CEDICT（内置 · 汉英）', label: '汉英 CC-CEDICT（12 万条）' },
  ecdict: { id: 'ecdict', file: 'dict/ecdict.csv.gz', name: 'ECDICT（内置 · 英汉双解）', label: '英汉双解 ECDICT（77 万条）' },
}
const builtinId = ref('cedict')

/* ---------------- 解压（原生优先，fflate 兜底） ---------------- */
async function maybeGunzip(buf) {
  const u8 = new Uint8Array(buf)
  const gz = u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b
  if (!gz) return new TextDecoder('utf-8').decode(u8)
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))
      return await new Response(stream).text()
    } catch { /* 老浏览器 / 损坏文件 → 走 fflate */ }
  }
  const { gunzipSync } = await import('fflate')
  return new TextDecoder('utf-8').decode(gunzipSync(u8))
}

/* ---------------- 装载词库 ---------------- */
async function applyEntries(text, name) {
  // 让浏览器先把 loading 画出来，再做重活
  await new Promise((r) => setTimeout(r, 16))
  // ref 会把对象深层包成 reactive Proxy，而 Proxy 无法 structured-clone，
  // postMessage 会抛 DataCloneError —— 传给 Worker 前必须展开成纯对象
  const v = ipaTexts.value
  const ipa = v ? { us: v.us || '', uk: v.uk || '' } : null
  const r = await loadDict(text, name, ipa)
  info.value = { entries: r.entries, words: r.words, ipaWords: r.ipaWords || 0 }
  buildMs.value = r.ms
  thread.value = r.thread
  sourceName.value = name
  run()
}

/* 空态里的「换词库」入口：切库后把当前查询重放一遍，避免用户还要再敲一次 */
function switchBuiltin(id) {
  if (builtinId.value === id || loading.value) return
  loadBuiltin(id).then(() => run())
}

// 模糊纠错是拿「词表」做编辑距离：英汉词库（ECDICT）的词表全是英文，
// 拿中文去纠错必然 0 条。此时不该在空态里推荐它，否则等于把用户往死胡同引。
const fuzzyUsable = computed(() => {
  const q = String(res.value?.query || '')
  const cjk = /[\u3400-\u9fff]/.test(q)
  if (!cjk) return true
  return builtinId.value !== 'ecdict'
})

async function loadBuiltin(id) {
  const src = BUILTIN_SOURCES[id || builtinId.value] || BUILTIN_SOURCES.cedict
  if (id) builtinId.value = src.id
  loading.value = true
  error.value = ''
  try {
    const base = import.meta.env.BASE_URL
    // 主词库 + 两份 IPA 音标库并行拉取；音标库失败不阻塞主流程（音标是增强，不是依赖）
    const [main, us, uk] = await Promise.all([
      fetch(`${base}${src.file}`),
      fetch(`${base}dict/en-ipa-us.txt.gz`).catch(() => null),
      fetch(`${base}dict/en-ipa-uk.txt.gz`).catch(() => null),
    ])
    if (!main.ok) {
      const hint = src.id === 'ecdict' ? '。可先在首页「离线内核」面板预缓存「英汉大词库 ECDICT」，或检查 fetch-dict 是否已拉取该数据' : ''
      throw new Error(`内置词库加载失败（HTTP ${main.status}）：${base}${src.file}${hint}`)
    }
    const text = await maybeGunzip(await main.arrayBuffer())
    ipaTexts.value = {
      us: us && us.ok ? await maybeGunzip(await us.arrayBuffer()) : '',
      uk: uk && uk.ok ? await maybeGunzip(await uk.arrayBuffer()) : '',
    }
    await applyEntries(text, src.name)
    precacheDict(src.id === 'ecdict' ? 'dict-en' : 'dict') // 后台静默预缓存（SW 管辖，访一次即可永久离线）
  } catch (e) {
    error.value = `${e.message}。可先在下方导入一份 CC-CEDICT / JSONL / TSV 词库继续使用。`
  } finally {
    loading.value = false
  }
}

/* ---------------- 词库预缓存（与 ffmpeg / tesseract 内核同一机制） ---------------- */
async function precacheDict(group = 'dict') {
  try {
    if (!swSupported()) return
    const st = await coreStatus()
    if (st && st.groups && st.groups[group] && st.groups[group].ready) return
    await precacheCores([group])
  } catch { /* SW 不可用就当没这回事，HTTP 缓存仍会兜底 */ }
}

/* ---------------- 检索（防抖 + 过期响应丢弃） ---------------- */
let timer = 0
let runSeq = 0
async function run() {
  const q = query.value.trim()
  if (!q) { res.value = null; suggest.value = []; return }
  const my = ++runSeq
  const r = await dictSearch(q, mode.value, 60)
  // 防抖间隔内又敲了字 / 切了模式：这份响应已过期，丢弃
  if (my !== runSeq || !r) return
  res.value = r
  // 空结果不能让用户对着空白页发懵：后台补跑一次模糊纠错，给出"你是不是想找"
  suggest.value = []
  if (!r.items.length) {
    suggestBusy.value = true
    const s = await dictSearch(q, 'fuzzy', 8).catch(() => null)
    if (my === runSeq && s) suggest.value = s.items
    suggestBusy.value = false
  }
}
watch([query, mode], () => {
  clearTimeout(timer)
  timer = setTimeout(run, 140)
})

function pickSample(s) {
  query.value = s
  run()
}

/* ---------------- 导入（成功后自动存入本机，可随时重载） ---------------- */
async function onFiles(files) {
  if (!files || !files.length) return
  loading.value = true
  error.value = ''
  try {
    const texts = []
    const names = []
    for (const f of files) {
      texts.push(await maybeGunzip(await f.arrayBuffer()))
      names.push(f.name)
    }
    const text = texts.join('\n')
    const name = names.join(' + ')
    await applyEntries(text, name)
    const rec = await saveLexicon({ name, text, count: info.value.entries })
    await refreshSaved()
    pushToast('ok', `已导入 ${info.value.entries.toLocaleString()} 条词条${rec.persisted ? '，已存入本机' : '（本机不支持持久化，仅本次会话可用）'}`)
  } catch (e) {
    error.value = '导入失败：' + (e.message || e)
    pushToast('err', '导入失败')
  } finally {
    loading.value = false
  }
}

/* ---------------- 我的词库（IndexedDB / 会话内存） ---------------- */
async function refreshSaved() {
  const list = await listLexicons()
  saved.value = list
  savedPersisted.value = !list.length || !!list[0].persisted
}

async function loadSaved(rec) {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    await applyEntries(rec.text, rec.name)
    pushToast('ok', `已载入「${rec.name}」`)
  } catch (e) {
    error.value = '载入失败：' + (e.message || e)
  } finally {
    loading.value = false
  }
}

async function removeSaved(id) {
  await deleteLexicon(id)
  await refreshSaved()
}

/* ---------------- 交互 ---------------- */
function toggle(i) { openIdx.value = openIdx.value === i ? -1 : i }

// 系统本地语音朗读（Web Speech API，零依赖、零外发请求；无语音包时静默失败）
function speak(variant) {
  if (!('speechSynthesis' in window)) { pushToast('err', '此浏览器不支持语音朗读'); return }
  try {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(res.value.query)
    u.lang = variant === 'us' ? 'en-US' : 'en-GB'
    u.rate = 0.9
    speechSynthesis.speak(u)
  } catch { pushToast('err', '朗读失败') }
}

async function copyEntry(it) {
  const lines = [`${it.s}${it.t && it.t !== it.s ? `（${it.t}）` : ''}  [${it.pm || it.p}]`, ...it.d.map((x, i) => `${i + 1}. ${x}`)]
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    pushToast('ok', '词条已复制')
  } catch {
    pushToast('err', '浏览器拒绝了剪贴板权限')
  }
}
function onKey(e) {
  if (e.key === 'Enter') { clearTimeout(timer); run() }
  if (e.key === 'Escape') { query.value = ''; res.value = null }
}

onMounted(() => {
  loadBuiltin()
  refreshSaved()
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <h1 class="page-title">离线词典</h1>
  <p class="page-sub">
    CC-CEDICT 汉英双向词库（约 12 万条）在浏览器内建索引，<b>零外发请求、断网可用</b>。
    支持汉字、带调拼音、无调拼音、首字母、英文释义五种查法。
  </p>

  <HelpTip title="为什么不直接用网上的「在线字典」？" icon="bi-shield-lock" open>
    <p style="margin:0">
      搜索引擎里的「在线新华字典」绝大多数<strong>未获授权</strong>（商务印书馆已公开声明《新华字典》无网页版），
      且音形义错漏常见。这里把词库当作本地文件：一次取回、永久离线、可替换、可审计，
      查询内容不会离开你的浏览器。
    </p>
  </HelpTip>

  <!-- 搜索区 -->
  <div class="panel">
    <div class="search-row">
      <i class="bi bi-search search-icon"></i>
      <input
        v-model="query"
        type="text"
        class="search-input"
        placeholder="汉字 / lvse / lü sè / nh / bicycle"
        autocomplete="off"
        spellcheck="false"
        @keydown="onKey"
      />
      <button v-if="query" class="btn ghost clear-btn" title="清空（Esc）" @click="query = ''; res = null">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>

    <div class="row">
      <div class="field" style="min-width:240px;flex:1">
        <label>检索模式</label>
        <select v-model="mode">
          <option v-for="m in MODES" :key="m" :value="m">{{ MODE_LABEL[m] }}</option>
        </select>
      </div>
      <div class="field" style="min-width:220px;flex:0 0 auto">
        <label>内置词库</label>
        <select v-model="builtinId" :disabled="loading" @change="loadBuiltin()">
          <option v-for="s in BUILTIN_SOURCES" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </div>
      <div class="field" style="flex:0 0 auto">
        <label>示例</label>
        <div class="samples">
          <button v-for="s in ['绿色', 'lvse', 'nǐ hǎo', 'nh', 'bicycle']" :key="s" class="chip" @click="pickSample(s)">{{ s }}</button>
        </div>
      </div>
    </div>

    <p v-if="builtinId === 'ecdict'" class="hint" style="margin:6px 0 0">
      ECDICT 77 万条双解：首载约 <b>21.7 MB</b>（之后由离线内核缓存，断网可用），
      建索引约 <b>4 秒</b>，常驻内存约 <b>500 MB</b> —— 桌面推荐；手机建议留在汉英词库。
    </p>

    <div class="status">
      <template v-if="info.entries">
        <i class="bi bi-database-check"></i>
        词库：<b>{{ sourceName }}</b> · <b>{{ info.entries.toLocaleString() }}</b> 条 ·
        索引构建 <b>{{ buildMs }} ms</b>（<span class="thread-badge">{{ thread === 'worker' ? '后台线程' : '主线程' }}</span>）
        <template v-if="info.ipaWords"> · 音标库 <b>{{ info.ipaWords.toLocaleString() }}</b> 词</template> · 全部本地
      </template>
      <template v-else-if="loading">正在装载词库并建索引…</template>
      <template v-else>词库尚未就绪</template>
    </div>

    <div v-if="loading" class="progress indeterminate"><span></span></div>
    <div v-if="error" class="msg err">{{ error }}</div>
  </div>

  <!-- 结果 -->
  <!-- 空结果：绝不能只留一片白 —— 说明为什么没查到、给出下一步动作与相近词 -->
  <div v-if="res && res.query && !res.items.length" class="empty-state">
    <div class="es-title"><i class="bi bi-search"></i> 未收录「{{ res.query }}」</div>

    <div v-if="suggest.length" class="es-block">
      <div class="es-label">你是不是想找</div>
      <div class="es-chips">
        <button v-for="it in suggest" :key="it.i" class="chip" @click="pickSample(it.s)">
          {{ it.s }}<span v-if="it.t && it.t !== it.s" class="es-trad">{{ it.t }}</span>
        </button>
      </div>
    </div>
    <div v-else-if="suggestBusy" class="es-block es-muted">正在找相近词…</div>

    <ul class="es-tips">
      <li v-if="builtinId === 'cedict'">
        当前是 <b>汉英词库 CC-CEDICT</b>（12 万条，只收常见词条）。中文释义可切到
        <a href="#" @click.prevent="switchBuiltin('ecdict')">英汉双解 ECDICT</a> 反查。
      </li>
      <li v-else>
        当前是 <b>英汉双解 ECDICT</b>（77 万条）。中文词条需用
        <a href="#" @click.prevent="switchBuiltin('cedict')">汉英 CC-CEDICT</a> 查。
      </li>
      <li v-if="mode !== 'fuzzy' && fuzzyUsable">
        或换 <a href="#" @click.prevent="mode = 'fuzzy'">模糊纠错</a> 模式，
        按编辑距离找字形相近的词。
      </li>
      <li>
        自有词库可直接拖入下方 <b>导入词库</b>（CC-CEDICT / JSONL / TSV），
        导入后同样离线可用。
      </li>
    </ul>
    <p class="es-muted" style="margin:8px 0 0">
      已尝试：精确 → 前缀 → 拼音 → 释义反查<template v-if="builtinId === 'ecdict'"> → 中文义项</template>。
    </p>
  </div>

  <div v-if="res && res.total" class="result-bar">
    <span><b>{{ res.total.toLocaleString() }}</b> 条结果 · {{ res.took }} ms</span>
    <span class="mono-note">查询「{{ res.query }}」</span>
  </div>

  <!-- 英语音标卡：查询单个英文词时由音标库给出（美式 / 英式） -->
  <div v-if="res && res.ipa" class="ipa-card">
    <div v-for="(ipas, v) in res.ipa" :key="v" class="ipa-row">
      <span class="ipa-tag">{{ v === 'us' ? '美' : '英' }}</span>
      <span class="ipa-val">/{{ ipas[0] }}/</span>
      <span v-if="ipas.length > 1" class="ipa-alt" :title="ipas.map((x) => '/' + x + '/').join('  ')">
        另有 {{ ipas.length - 1 }} 种读音
      </span>
      <button class="ipa-play" title="朗读单词" @click="speak(v)">
        <i class="bi bi-volume-up-fill"></i>
      </button>
    </div>
    <span class="ipa-src">音标数据：open-dict-data/ipa-dict（MIT）· 朗读使用系统本地语音</span>
  </div>

  <div v-if="res && res.items.length" class="dict-list">
    <div v-for="it in res.items" :key="it.i" class="dict-item" :class="{ open: openIdx === it.i }">
      <div class="di-head" @click="toggle(it.i)">
        <span class="di-word">{{ it.s }}</span>
        <span v-if="it.t && it.t !== it.s" class="di-trad">{{ it.t }}</span>
        <span v-if="it.pm" class="di-py">{{ it.pm }}</span>
        <span class="di-hit" :data-hit="it.hit">{{ HIT_LABEL[it.hit] || it.hit }}</span>
        <i class="bi di-caret" :class="openIdx === it.i ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
      </div>
      <div class="di-def" v-if="it.d.length">{{ it.d[0] }}</div>
      <div v-if="openIdx === it.i" class="di-more">
        <ol>
          <li v-for="(d, k) in it.d" :key="k">{{ d }}</li>
        </ol>
        <p v-if="!it.d.length" class="hint" style="margin:8px 0 0">这条没有释义，可能来自自定义词库。</p>
        <div class="row" style="margin:10px 0 0">
          <span class="hint" style="margin:0;flex:1">
            原始拼音：<code>{{ it.p || '—' }}</code> · 词条序号 #{{ it.i }}
          </span>
          <button class="btn ghost" @click="copyEntry(it)"><i class="bi bi-clipboard"></i> 复制词条</button>
        </div>
      </div>
    </div>
  </div>

  <div v-else-if="res && !res.items.length" class="msg info">
    没有命中。换个写法试试：汉字可查「前缀」，外语可试 <b>无调拼音</b>（lvse）、<b>首字母</b>（nh），
    或把模式切到「模糊纠错」。
  </div>

  <!-- 空态 -->
  <div v-if="!res && info.entries" class="panel empty-hint">
    <i class="bi bi-journal-text"></i>
    <p>输入一个字、一个词，或一段拼音开始。全部检索在你本机完成。</p>
  </div>

  <!-- 导入 -->
  <details class="panel">
    <summary class="import-summary"><i class="bi bi-box-arrow-in-down"></i> 导入自己的词库（替换当前词库）</summary>
    <p class="hint" style="margin-top:12px">
      支持 <b>CC-CEDICT</b>（.txt / .txt.gz）、<b>Kaikki / Wiktextract</b>（.jsonl）、<b>TSV</b>（词 ⇥ 拼音 ⇥ 释义，释义用 | 分隔）。
      文件只在本地解析，不会上传。
    </p>
    <DropZone
      :multiple="true"
      accept=".txt,.gz,.jsonl,.json,.tsv,.csv"
      hint="拖放词库文件到此处，或点击选择"
      formats="CC-CEDICT .txt / .gz · JSONL · TSV"
      single="词库"
      @files="onFiles"
    />
    <div v-if="saved.length" class="saved-row">
      <span class="hint" style="margin:0">我的词库（{{ savedPersisted ? '已存本机' : '仅本次会话' }}，点击重载）：</span>
      <span class="saved-chips">
        <span v-for="s in saved" :key="s.id" class="saved-item">
          <button class="chip" :title="`${s.count.toLocaleString()} 条 · ${new Date(s.addedAt).toLocaleString()}`" @click="loadSaved(s)">
            {{ s.name }} · {{ s.count.toLocaleString() }}
          </button>
          <button class="saved-del" title="删除" @click="removeSaved(s.id)"><i class="bi bi-x"></i></button>
        </span>
      </span>
    </div>
    <div class="row">
      <button class="btn ghost" @click="loadBuiltin"><i class="bi bi-arrow-counterclockwise"></i> 恢复内置词库</button>
    </div>
  </details>

  <!-- 数据来源 -->
  <div class="panel">
    <h3 style="margin-top:0;font-size:15px"><i class="bi bi-info-circle"></i> 数据来源与许可</h3>
    <ul class="src-list">
      <li>
        <b>CC-CEDICT</b> —— 社区维护的汉英词典，<b>CC BY-SA 4.0</b> 许可，约 12 万条。
        本项目内置文件位于 <code>public/dict/cc-cedict.txt.gz</code>，随仓库以相同许可分发。
      </li>
      <li>
        <b>ECDICT</b> —— 开源英汉/英英双解词库（<b>MIT</b> 许可，约 77 万条，含音标/词频/考级标签），
        文件位于 <code>public/dict/ecdict.csv.gz</code>（不入 Git，由 <code>fetch-dict</code> 拉取），
        可在上方「内置词库」切换装载，也可在首页「离线内核」预缓存后断网使用。
      </li>
      <li>
        <b>Kaikki / Wiktextract</b> —— 维基词典结构化导出（CC BY-SA），可用「导入」按语言增量补充。
      </li>
      <li>
        <b>方法论</b>：词库 ⇄ 索引 ⇄ 检索三层解耦，换源不改代码；索引常驻后台线程，刷新即重建；
        导入的自定义词库经 <b>IndexedDB</b> 存在本机（最多 5 份），随时可重载。
      </li>
    </ul>
    <p class="hint" style="margin-bottom:0">
      需要「规范到出版级」的现代汉语释义时，请使用商务印书馆《现代汉语词典》App 等正版渠道；
      本工具定位是<b>可审计、可离线、可替换</b>的极客方案，不以替代权威辞书为目标。
    </p>
  </div>
</template>

<style scoped>
.search-row { display: flex; align-items: center; gap: 10px; position: relative; }
.search-icon { position: absolute; left: 14px; color: var(--accent); font-size: 17px; pointer-events: none; }
.search-input {
  flex: 1; width: 100%; padding: 13px 14px 13px 42px !important;
  font-size: 16px !important; border-radius: 12px !important;
}
.clear-btn { padding: 8px 10px; }

.samples { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  display: inline-flex; align-items: center; padding: 4px 11px; border-radius: 999px;
  font-size: 12.5px; cursor: pointer; color: var(--muted);
  border: 1px solid var(--line-strong); background: var(--panel-2); transition: .15s;
}
.chip:hover { color: var(--accent); border-color: var(--accent); background: rgba(232,149,74,.08); }

.thread-badge {
  font-size: 11px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--line-strong); color: var(--muted);
}

.ipa-card {
  display: flex; flex-direction: column; gap: 6px;
  margin: 0 0 12px; padding: 12px 16px;
  border: 1px solid rgba(52, 211, 153, .35); border-radius: var(--radius-sm);
  background: rgba(52, 211, 153, .06);
}
.ipa-row { display: flex; align-items: center; gap: 10px; }
.ipa-tag {
  font-size: 11px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid rgba(52, 211, 153, .5); color: var(--accent-2, #34d399);
}
.ipa-val { font-family: var(--mono); font-size: 15px; color: var(--txt); letter-spacing: .3px; }
.ipa-alt { font-size: 11.5px; color: var(--faint); cursor: help; }
.ipa-play {
  margin-left: auto; border: none; background: none; cursor: pointer;
  color: var(--accent); font-size: 15px; padding: 2px 6px;
}
.ipa-play:hover { transform: scale(1.15); }
.ipa-src { font-size: 11px; color: var(--faint); }

.saved-row { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.saved-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.saved-item { display: inline-flex; align-items: center; gap: 2px; }
.saved-del {
  border: none; background: none; cursor: pointer; padding: 2px 4px;
  color: var(--faint); font-size: 13px; line-height: 1;
}
.saved-del:hover { color: #f87171; }

.result-bar {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  margin: 16px 2px 8px; font-size: 12.5px; color: var(--muted);
}
.result-bar b { color: var(--accent); }
.mono-note { font-family: var(--mono); color: var(--faint); }

/* 空结果面板：说明 + 相近词 + 下一步动作 */
.empty-state {
  margin: 16px 0 8px; padding: 16px 18px; border-radius: 12px;
  border: 1px dashed var(--line-strong); background: var(--panel-2);
}
.es-title { display: flex; align-items: center; gap: 8px; font-size: 14.5px; font-weight: 600; color: var(--txt); }
.es-title i { color: var(--warn, #f59e0b); }
.es-block { margin-top: 12px; }
.es-label { font-size: 12px; color: var(--faint); margin-bottom: 6px; }
.es-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.es-trad { color: var(--faint); margin-left: 4px; font-size: 11.5px; }
.es-tips { margin: 12px 0 0; padding-left: 18px; font-size: 12.5px; line-height: 1.85; color: var(--muted); }
.es-tips a { color: var(--accent); text-decoration: none; border-bottom: 1px dashed currentColor; }
.es-tips a:hover { border-bottom-style: solid; }
.es-muted { font-size: 12px; color: var(--faint); }

.dict-list { display: flex; flex-direction: column; gap: 8px; }
.dict-item {
  border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: var(--panel-2); overflow: hidden; transition: border-color .15s;
}
.dict-item.open, .dict-item:hover { border-color: rgba(232,149,74,.45); }
.di-head {
  display: flex; align-items: center; gap: 10px; padding: 11px 14px; cursor: pointer;
}
.di-word { font-size: 18px; font-weight: 700; color: var(--txt); letter-spacing: .5px; }
.di-trad { font-size: 13px; color: var(--faint); }
.di-py { font-family: var(--mono); font-size: 13px; color: var(--accent-2, #34d399); margin-left: 2px; }
.di-hit {
  margin-left: auto; font-size: 11px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--line-strong); color: var(--faint);
}
.di-hit[data-hit="exact"] { color: var(--accent); border-color: rgba(232,149,74,.5); }
.di-hit[data-hit="fuzzy"] { color: #fbbf24; border-color: rgba(251,191,36,.45); }
.di-caret { color: var(--faint); font-size: 12px; }
.di-def { padding: 0 14px 11px; color: var(--muted); font-size: 13.5px; line-height: 1.6; }
.di-more { padding: 0 14px 12px; border-top: 1px dashed var(--line); }
.di-more ol { margin: 10px 0 0; padding-left: 22px; color: var(--muted); font-size: 13px; line-height: 1.8; }
.di-more code { font-family: var(--mono); color: var(--accent); }

.empty-hint { text-align: center; color: var(--faint); }
.empty-hint i { font-size: 32px; display: block; margin-bottom: 8px; color: var(--accent); opacity: .7; }
.empty-hint p { margin: 0; font-size: 13px; }

.import-summary { cursor: pointer; font-size: 14px; font-weight: 600; color: var(--txt); list-style: none; }
.import-summary::-webkit-details-marker { display: none; }
.import-summary i { color: var(--accent); margin-right: 6px; }

.src-list { color: var(--muted); font-size: 13px; line-height: 1.9; margin: 8px 0 12px; padding-left: 20px; }
.src-list code { font-family: var(--mono); color: var(--accent); font-size: 12px; }
</style>
