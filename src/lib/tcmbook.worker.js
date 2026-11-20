// 方书库检索 Worker（第 7 期）。
// 协议（与第 4 期 poem.worker.js 对齐）:
//   → { type:'init' }          ← { type:'ready', books, shardFrom, entries, have, total }
//   → { type:'search', q, book, limit, reqId }
//                              ← { type:'results', reqId, hits, titleOnly, scanned, truncated, missing }
//   → { type:'dispose' }
// IDB 精简只读逻辑内置，不 import 下载模块（避免把下载/删除 API 带进 Worker）。
import { searchEntries } from './tcmbooksearch.js'

const DB_NAME = 'lf-tcmfull'
const META_STORE = 'meta'
const SHARD_STORE = 'shards'
const META_ID = 'full'

let entries = null
let shardFrom = null
let books = null
const texts = new Map()

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
  if (!meta) throw new Error('未安装：IndexedDB 里没有方书库元数据')
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
      postMessage({ type: 'ready', ...(await init()) })
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
