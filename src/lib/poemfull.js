// 全量库（L2）数据层：全唐诗 / 全宋词 / 全元曲，共约 8.9 万首。
//
// 与 L1（poems.js）的根本区别：L2 体积大（gzip 约 12 MB），**永远不预加载**。
// 用户在「诗文精选 → 全量库」里点了下载，才拉索引和分片；数据缓存到 IndexedDB，
// 中断可续传（已下的片不重拉），可随时删除。
//
// 结构约定（与 scripts/fetch-poems-full.mjs 严格对应）：
//   index = { v, built, shards, shardFrom[], books[], entries[] }
//   entries[g] = [book, shard, off, title, author]   // g = 全局序号
//   shard s 的全文 = [[title, author, text], ...]，items[off] 即全局序号 shardFrom[s]+off
//
// 检索放 Worker（poem.worker.js）：8.9 万首约 25 MB 文本，主线程 indexOf 一遍要
// 卡顿 100ms+，Worker 里做则是无感的。本模块只负责下载、缓存与取正文。
import { fetchGzJson } from './gzjson.js'

const INDEX_FILE = 'classics/full-index.json.gz'
const FETCH_CMD = 'npm run poems-full:fetch'
const DB_NAME = 'lf-poems'
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

/* ---------------- 状态 ---------------- */

// { installed, built, shards, have, books } ；未安装时 installed=false
export async function fullStatus() {
  try {
    const meta = await withStore('readonly', (m) => request(m.get(META_ID)))
    if (!meta) return { installed: false, have: 0 }
    const keys = await withStore('readonly', (_m, s) => request(s.getAllKeys()))
    return { installed: true, built: meta.built, shards: meta.shards, books: meta.books, have: keys.length, memoryOnly }
  } catch {
    return { installed: false, have: 0, memoryOnly }
  }
}

export async function loadIndexLocal() {
  const meta = await withStore('readonly', (m) => request(m.get(META_ID)))
  return meta ? { entries: meta.entries, shardFrom: meta.shardFrom, books: meta.books, built: meta.built, shards: meta.shards, v: meta.v } : null
}

/* ---------------- 下载 / 删除 ---------------- */

// onProgress(done, total, phase)。phase: 'index' | 'shards' | 'done'
// 续传：IDB 里已有的分片直接跳过，因此中断后重下只补缺片。
export async function downloadFull(onProgress) {
  let index
  try {
    onProgress?.(0, 1, 'index')
    const { data } = await fetchGzJson(INDEX_FILE, { cmd: FETCH_CMD, label: '全量库索引' })
    index = data
    if (index.v !== 1 || !Array.isArray(index.entries)) throw new Error('索引结构异常，请重新生成数据快照')
  } catch (e) {
    throw e
  }

  const total = index.shards
  let done = 0
  let cursor = 0
  const fails = []

  async function worker() {
    while (cursor < total) {
      const s = cursor++
      // 已有分片跳过（断点续传）
      let have = null
      try {
        have = await withStore('readonly', (_m, st) => request(st.get(s)))
      } catch {
        /* IDB 不可用 → 不缓存，每次都从网络拿 */
      }
      if (!have) {
        const { data: items } = await fetchGzJson(`classics/full/s${s}.json.gz`, {
          cmd: FETCH_CMD,
          label: `全量库分片 s${s}`,
        })
        if (!Array.isArray(items) || !items.length) throw new Error(`分片 s${s} 内容为空`)
        if (!memoryOnly) {
          try {
            await withStore('readwrite', (_m, st) => {
              st.put({ id: s, items })
            })
          } catch {
            /* 存不进就算了，本轮会话内 Worker 仍可用 */
          }
        }
      }
      done++
      onProgress?.(done, total, 'shards')
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker().catch((e) => fails.push(e))))
  if (fails.length) throw new Error(fails[0]?.message || '部分分片下载失败')

  const meta = { id: META_ID, v: index.v, built: index.built, shards: index.shards, shardFrom: index.shardFrom, books: index.books, entries: index.entries, savedAt: Date.now() }
  if (!memoryOnly) {
    try {
      await withStore('readwrite', (m) => m.put(meta))
    } catch {
      /* 隐私模式：本轮会话靠内存，刷新即失（Worker 侧同样） */
    }
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
  } catch {
    /* IDB 不可用则无事可删 */
  }
  memShards.clear()
}

/* ---------------- 正文读取 ---------------- */

// 取一篇全文。优先内存，其次 IDB，再走网络（正常流程下已装库，网络路径是兜底）。
export async function readPiece(shard, off) {
  let items = memShards.get(shard)
  if (!items) {
    try {
      const rec = await withStore('readonly', (_m, s) => request(s.get(shard)))
      items = rec?.items
    } catch {
      /* IDB 不可用 */
    }
    if (items) memShards.set(shard, items)
  }
  if (!items) {
    const { data } = await fetchGzJson(`classics/full/s${shard}.json.gz`, {
      cmd: FETCH_CMD,
      label: `全量库分片 s${shard}`,
    })
    items = data
    memShards.set(shard, items)
  }
  const it = items[off]
  if (!it) throw new Error(`分片 s${shard}#${off} 越界`)
  return { title: it[0], author: it[1], text: it[2] }
}

export function rememberShard(shard, items) {
  memShards.set(shard, items)
}
