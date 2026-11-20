// 《本草纲目》结构化库（中医药经典模块第 6 期）数据层。
//
// 双份数据，两种待遇（与第 4 期全量库同范式）：
//   - 索引 bencao-index.json.gz（约 107KB）：部→卷→药名树 + 每条主治摘要，
//     随包内嵌、页面进来就加载——没下载全量也能浏览目录、检索药名/主治摘要；
//   - 全量 bencao.json.gz（约 2.19MB）：用户点了下载才拉，缓存到 IndexedDB（库名 lf-tcm），
//     单文件无分片（体积小，不需要 L2 的 46 分片机制），可删除。
//
// 传输格式为定长数组（scripts/fetch-bencao.mjs 严格对应）：
//   全量 items[i] = [dirIdx, name, body, excerpt]   // body 含【释名】【气味】【主治】…分节
//   索引 items[i] = [dirIdx, name, excerpt]
//   dirs[d]   = '草部第十二卷\草之一'（107 种；'' 表示序例条目）
//
// 全文检索走主线程：1921 条约 200 万字，indexOf 一遍 < 20ms，不值得开 Worker
//（第 4 期开 Worker 是因为 8.9 万首 25MB 文本，量级差一个数量级）。
import { fetchGzJson, dataUrl, decodeMaybeGzip } from './gzjson.js'

const INDEX_FILE = 'tcm/bencao-index.json.gz'
const FULL_FILE = 'tcm/bencao.json.gz'
const CMD = 'npm run bencao:fetch'
const DB_NAME = 'lf-tcm'
const STORE = 'data'
const META_ID = 'bencao'

let dbPromise = null
let memoryOnly = false

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      memoryOnly = true
      reject(new Error('no-idb'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore(mode, fn) {
  const db = await openDB()
  const tx = db.transaction([STORE], mode)
  const out = await fn(tx.objectStore(STORE))
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(out)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/* ---------------- 部名规范化（与 fetch-bencao.mjs 的 buOf 对应） ---------------- */

// 原书 16 部：水火土金石草木谷菜果木服器虫鳞介禽兽人。
// 上游目录字段两处不规范在此归位：土部条目挂在「纲目第七卷」下；卷 9-11 的「石部」是金石部延续。
const BU_RE = /^(.+?部)/
export function buOf(dir) {
  if (!dir) return '序例'
  const head = dir.split('\\')[0]
  if (head.startsWith('纲目')) return '土部'
  const m = head.match(BU_RE)
  if (!m) return '序例'
  return m[1] === '石部' ? '金石部' : m[1]
}

/* ---------------- 索引（内嵌，始终可用） ---------------- */

let idxCache = null
let idxInflight = null

function expandIndex(data) {
  const items = data.items.map((a, i) => {
    const dir = data.dirs[a[0]] || ''
    const parts = dir.split('\\')
    return {
      id: i,
      dir,
      dirIdx: a[0],
      juan: parts[0] || '序例',
      sub: parts[1] || '',
      bu: buOf(dir),
      name: a[1],
      excerpt: a[2] || '',
    }
  })

  // 部→卷（目录段）→条 三级树。序例（含百病主治药）排最前，其余按原书部次。
  const buNames = [...new Set(items.map((it) => it.bu))]
  const tree = buNames.map((bu) => {
    const juans = []
    const seen = new Map()
    for (const it of items) {
      if (it.bu !== bu) continue
      const juan = it.dir || '序例'
      if (!seen.has(juan)) {
        const g = { juan, sub: it.sub, items: [] }
        seen.set(juan, g)
        juans.push(g)
      }
      seen.get(juan).items.push(it)
    }
    return { bu, juans, count: juans.reduce((s, g) => s + g.items.length, 0) }
  })
  return { v: data.v, built: data.built, bu: buNames, items, tree, stats: { total: items.length } }
}

export async function loadIndex() {
  if (idxCache) return idxCache
  if (idxInflight) return idxInflight
  idxInflight = (async () => {
    const { data } = await fetchGzJson(INDEX_FILE, { cmd: CMD, label: '本草纲目索引' })
    if (data.v !== 1 || !Array.isArray(data.items) || !Array.isArray(data.dirs)) {
      throw new Error('本草纲目索引结构异常，请重新运行 ' + CMD)
    }
    idxCache = expandIndex(data)
    return idxCache
  })()
  try {
    return await idxInflight
  } finally {
    idxInflight = null
  }
}

/* ---------------- 索引检索（药名 / 主治摘要，无需下载全量） ---------------- */

export function searchIndex(idx, q) {
  const query = q.trim().toLowerCase()
  if (!query) return []
  const terms = query.split(/\s+/).filter(Boolean)
  const out = []
  for (const it of idx.items) {
    const hay = `${it.name}\n${it.excerpt}\n${it.bu}${it.juan}`.toLowerCase()
    if (terms.every((t) => hay.includes(t))) out.push(it)
  }
  return out
}

/* ---------------- 全量（IndexedDB 下载管理） ---------------- */

let fullCache = null

function expandFull(data) {
  // 与索引同构，但带 body。索引展开结果若已在内存，直接挂上 body（同一 id 序）。
  return data.items.map((a, i) => ({ id: i, dirIdx: a[0], name: a[1], body: a[2], excerpt: a[3] || '' }))
}

export async function fullStatus() {
  try {
    const rec = await withStore('readonly', (st) => request(st.get(META_ID)))
    if (!rec) return { installed: false }
    return { installed: true, built: rec.built, savedAt: rec.savedAt, memoryOnly }
  } catch {
    return { installed: false, memoryOnly }
  }
}

// onProgress(loadedBytes, totalBytes, phase)；phase: 'download' | 'done'
export async function downloadFull(onProgress) {
  const res = await fetch(dataUrl(FULL_FILE))
  if (!res.ok) throw new Error(`全量下载失败：HTTP ${res.status}`)
  const total = Number(res.headers.get('Content-Length')) || 0
  let buf
  if (res.body && total) {
    const reader = res.body.getReader()
    const chunks = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      onProgress?.(loaded, total, 'download')
    }
    buf = new Uint8Array(loaded)
    let off = 0
    for (const c of chunks) {
      buf.set(c, off)
      off += c.length
    }
  } else {
    buf = new Uint8Array(await res.arrayBuffer())
    onProgress?.(buf.length, buf.length, 'download')
  }
  const text = await decodeMaybeGzip(buf.buffer)
  const data = JSON.parse(text)
  if (data.v !== 1 || !Array.isArray(data.items)) throw new Error('全量数据结构异常，请重新运行 ' + CMD)

  const rec = { id: META_ID, v: data.v, built: data.built, items: data.items, savedAt: Date.now() }
  if (!memoryOnly) {
    try {
      await withStore('readwrite', (st) => st.put(rec))
    } catch {
      /* 隐私模式：本轮会话内存可用，刷新即失 */
    }
  }
  fullCache = expandFull(data)
  onProgress?.(1, 1, 'done')
  return fullCache
}

// 读全量（已装库）。返回 [{ id, dirIdx, name, body, excerpt }]
export async function readFull() {
  if (fullCache) return fullCache
  try {
    const rec = await withStore('readonly', (st) => request(st.get(META_ID)))
    if (!rec) return null
    fullCache = expandFull({ items: rec.items })
    return fullCache
  } catch {
    return null
  }
}

export async function removeFull() {
  fullCache = null
  try {
    await withStore('readwrite', (st) => st.clear())
  } catch {
    /* IDB 不可用则无事可删 */
  }
}

/* ---------------- 全文检索（已装库；主线程足够快，见文件头注释） ---------------- */

// 返回 [{ id, name, dirIdx, body, excerpt, hit: {count, first} }]，按命中次数降序。
export function searchFull(items, q, { pool = null } = {}) {
  const query = q.trim().toLowerCase()
  if (!query) return []
  const terms = query.split(/\s+/).filter(Boolean)
  const src = pool || items
  const out = []
  for (const it of src) {
    const hay = `${it.name}\n${(it.body || '').toLowerCase()}`
    if (!terms.every((t) => hay.includes(t))) continue
    let count = 0
    let first = -1
    for (const t of terms) {
      let idx = 0
      for (;;) {
        const j = hay.indexOf(t, idx)
        if (j < 0) break
        if (first < 0) first = j
        count++
        idx = j + t.length
        if (count > 999) break
      }
    }
    out.push({ ...it, hit: { count, first } })
  }
  out.sort((a, b) => b.hit.count - a.hit.count)
  return out
}

/* ---------------- 条目正文分节 ---------------- */

// body 按【X】分节。返回 { origin, sections: [{ tag, text }] }
//（标签表实测 324 种，常见的固定展示，其余原样保留——不做翻译，古籍用语本身就是要展示的内容）
const KNOWN_TAGS = ['释名', '集解', '修治', '气味', '主治', '发明', '附方', '附录', '校正', '正误']

export function splitSections(body) {
  const text = String(body || '')
  const origin = text.startsWith('（') ? text.slice(0, text.indexOf('）') + 1).replace(/（\s*）/, '') : ''
  const rest = origin ? text.slice(origin.length) : text
  const parts = rest.split(/(?=【)/)
  const sections = []
  for (const p of parts) {
    const t = p.trim()
    if (!t) continue
    const m = t.match(/^【([^】]{1,4})】([\s\S]*)$/)
    if (m) sections.push({ tag: m[1], text: m[2].trim(), known: KNOWN_TAGS.includes(m[1]) })
    else sections.push({ tag: '', text: t, known: false })
  }
  return { origin: origin.replace(/^（|）$/g, ''), sections }
}
