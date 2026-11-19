// 全量库检索 Worker（第 4 期）。
//
// 为什么检索必须在 Worker：全量 8.9 万首约 25 MB 正文，一次关键词全文扫描在主线程
// 要 100ms+，输入时逐字触发会明显卡顿；Worker 里做完全无感。
//
// 数据来源：IndexedDB（下载管理在 poemfull.js，本 Worker 自带一份精简只读逻辑，
// 不 import 那边，避免把下载/删除这些用不到的 API 也带进来）。
// 检索规则在 poemsearch.js，与单测共用同一份实现。
//
// 协议（postMessage）：
//   → { type: 'init' }                 ← { type: 'ready', books, shardFrom, entries, have, total }
//                                       或 { type: 'error', message }
//   → { type: 'search', q, book, limit, reqId }
//                                      ← { type: 'results', reqId, hits, titleOnly, scanned, truncated, missing }
//   → { type: 'dispose' }              （自我关闭）
//
// hits: { g, book, shard, off, title, author, snippet }
//   g = 全局序号；主线程按 shard/off 取正文，展示按 g 去重。
import { searchEntries } from './poemsearch.js'

const DB_NAME = 'lf-poems'
const META_STORE = 'meta'
const SHARD_STORE = 'shards'
const META_ID = 'full'

let entries = null // [book, shard, off, title, author]
let shardFrom = null
let books = null
const texts = new Map() // shard → items

function idbGetAll(store) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      try {
        const tx = db.transaction(store, 'readonly')
        const out = tx.objectStore(store).getAll()
        out.onsuccess = () => resolve(out.result)
        out.onerror = () => reject(out.error)
      } catch (e) {
        reject(e)
      }
    }
  })
}

async function init() {
  const metas = await idbGetAll(META_STORE)
  const meta = metas.find((m) => m.id === META_ID)
  if (!meta) throw new Error('未安装：IndexedDB 里没有全量库元数据')
  entries = meta.entries
  shardFrom = meta.shardFrom
  books = meta.books

  const recs = await idbGetAll(SHARD_STORE)
  for (const r of recs) texts.set(r.id, r.items)
  return { books, shardFrom, entries, have: recs.length, total: meta.shards }
}

self.onmessage = async (e) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      const info = await init()
      postMessage({ type: 'ready', ...info })
    } else if (msg.type === 'search') {
      const r = searchEntries({ entries, shardFrom, texts, q: msg.q, book: msg.book, limit: msg.limit })
      postMessage({ type: 'results', reqId: msg.reqId, ...r })
    } else if (msg.type === 'dispose') {
      self.close()
    }
  } catch (err) {
    postMessage({ type: 'error', message: err?.message || String(err), reqId: msg.reqId })
  }
}
