// 方书与医经库（L2）数据层：9 本医籍 / 5954 篇 / 219 万字。
//
// 与第 4 期全量库同构：索引（57KB）随包内嵌、分片（2.4MB / 17 片）按需下载进 IndexedDB，
// 4 路并发、断点续传（已下分片不重拉）、可删除。库名 `lf-tcmfull`，与诗词库互不干扰。
//
// 结构约定（与 scripts/fetch-tcmbooks.mjs 严格对应）：
//   index = { v, built, books[], entries[], shardFrom[] }
//   entries[g] = [book, shard, off, title, juan, sub]   // g = 全局序号
//   shard s 全文 = [[title, text], ...]，items[off] 即正文
//
// 检索在 Worker（tcmbook.worker.js）：219 万字正文逐字扫描在主线程会卡顿，
// 规则实现在 tcmbooksearch.js 与单测共用。
import { fetchGzJson } from './gzjson.js'

const INDEX_FILE = 'tcm/full-index.json.gz'
const DB_NAME = 'lf-tcmfull'
const META_STORE = 'meta'
const SHARD_STORE = 'shards'
const META_ID = 'full'
const CONCURRENCY = 4

let dbPromise = null
let memoryOnly = false
const memShards = new Map()

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
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(SHARD_STORE)) db.createObjectStore(SHARD_STORE, { keyPath: 'id' })
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
  const tx = db.transaction([META_STORE, SHARD_STORE], mode)
  const out = await fn(tx.objectStore(META_STORE), tx.objectStore(SHARD_STORE))
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(out)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/* ---------------- 内嵌索引（未装库也能用：目录 + 标题检索） ---------------- */

let indexCache = null
let indexInflight = null

export async function loadIndex() {
  if (indexCache) return indexCache
  if (indexInflight) return indexInflight
  indexInflight = (async () => {
    const { data } = await fetchGzJson(INDEX_FILE, { cmd: 'npm run tcmbooks:fetch', label: '方书库索引' })
    if (data.v !== 1 || !Array.isArray(data.entries) || !Array.isArray(data.books)) {
      throw new Error('方书库索引结构异常，请重新运行 npm run tcmbooks:fetch')
    }
    indexCache = data
    return data
  })()
  try {
    return await indexInflight
  } finally {
    indexInflight = null
  }
}

/* ---------------- 状态 ---------------- */

export async function fullStatus() {
  try {
    const meta = await withStore('readonly', (m) => request(m.get(META_ID)))
    if (!meta) return { installed: false, have: 0 }
    const keys = await withStore('readonly', (_m, s) => request(s.getAllKeys()))
    return { installed: true, built: meta.built, shards: meta.shards, have: keys.length, memoryOnly }
  } catch {
    return { installed: false, have: 0, memoryOnly }
  }
}

/* ---------------- 下载 / 删除 ---------------- */

// onProgress(done, total, phase)，phase: 'index' | 'shards' | 'done'
// 续传：IDB 里已有的分片直接跳过；索引每一次下载都重拉（57KB，便宜且保证最新）。
export async function downloadFull(onProgress) {
  let index
  try {
    onProgress?.(0, 1, 'index')
    const fetched = await fetchGzJson(INDEX_FILE, {
      cmd: 'npm run tcmbooks:fetch',
      label: '方书库索引',
    })
    index = fetched.data
    if (index.v !== 1 || !Array.isArray(index.entries) || !Array.isArray(index.shardFrom)) {
      throw new Error('索引结构异常，请重新运行 npm run tcmbooks:fetch')
    }
  } catch (e) {
    await loadIndex() // 页面已内嵌索引，联网失败也把内嵌版准备好（调用方会显示降级）
    throw e
  }

  const total = index.shardFrom.length
  let done = 0
  let cursor = 0
  const fails = []

  async function worker() {
    while (cursor < total) {
      const s = cursor++
      let have = null
      try {
        have = await withStore('readonly', (_m, st) => request(st.get(s)))
      } catch { /* IDB 不可用 → 本轮会话内存 */ }
      if (!have) {
        const { data: items } = await fetchGzJson(`tcm/full/s${s}.json.gz`, {
          cmd: 'npm run tcmbooks:fetch',
          label: `方书库分片 s${s}`,
        })
        if (!Array.isArray(items) || !items.length) throw new Error(`分片 s${s} 内容为空`)
        memShards.set(s, items)
        if (!memoryOnly) {
          try {
            await withStore('readwrite', (_m, st) => st.put({ id: s, items }))
          } catch { /* 隐私模式：内存兜底 */ }
        }
      } else {
        memShards.set(s, have.items)
      }
      done++
      onProgress?.(done, total, 'shards')
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker().catch((e) => fails.push(e))))
  if (fails.length) throw new Error(fails[0]?.message || '部分分片下载失败')

  const meta = { id: META_ID, v: index.v, built: index.built, shards: total, books: index.books, entries: index.entries, shardFrom: index.shardFrom, savedAt: Date.now() }
  if (!memoryOnly) {
    try {
      await withStore('readwrite', (m) => m.put(meta))
    } catch { /* 隐私模式：本轮会话内存可用 */ }
  }
  onProgress?.(total, total, 'done')
  return index
}

export async function removeFull() {
  try {
    await withStore('readwrite', (m, s) => {
      m.clear()
      s.clear()
    })
  } catch { /* IDB 不可用则无事可删 */ }
  memShards.clear()
}

/* ---------------- 正文读取 ---------------- */

// 取一篇正文。优先内存，其次 IDB，最后网络兜底（正常流程下已装库）。
export async function readPiece(shard, off) {
  let items = memShards.get(shard)
  if (!items) {
    try {
      const rec = await withStore('readonly', (_m, s) => request(s.get(shard)))
      items = rec?.items
    } catch { /* IDB 不可用 */ }
    if (items) memShards.set(shard, items)
  }
  if (!items) {
    const { data } = await fetchGzJson(`tcm/full/s${shard}.json.gz`, {
      cmd: 'npm run tcmbooks:fetch',
      label: `方书库分片 s${shard}`,
    })
    items = data
    memShards.set(shard, items)
  }
  const it = items[off]
  if (!it) throw new Error(`分片 s${shard}#${off} 越界`)
  return { title: it[0], text: it[1] }
}

export function rememberShard(shard, items) {
  memShards.set(shard, items)
}
