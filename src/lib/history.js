// 本地"最近处理"记录：全部存在浏览器 IndexedDB，纯本地、不上传。
// 兜底：若 IndexedDB 不可用（隐私模式等），退化为 localStorage。
const DB_NAME = 'lf-history'
const STORE = 'records'
const MAX = 24
let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no-idb')); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function idbAll() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}
async function idbAdd(rec) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    store.add({ ...rec, t: Date.now() })
    // 超出上限则删除最旧的
    store.count().onsuccess = (e) => {
      const n = e.target.result
      if (n > MAX) store.openCursor().onsuccess = (c) => { if (c.target.result) { store.delete(c.target.result.key); return } }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
async function idbClear() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---------- localStorage 兜底 ----------
const LS_KEY = 'lf-history-ls'
function lsAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function lsAdd(rec) {
  const list = lsAll()
  list.push({ ...rec, t: Date.now(), id: Date.now() })
  while (list.length > MAX) list.shift()
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}
function lsClear() { try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ } }

let useIdb = true

export async function addHistory(rec) {
  if (useIdb) {
    try { await idbAdd(rec); return } catch { useIdb = false }
  }
  lsAdd(rec)
}

export async function getHistory() {
  let list = []
  if (useIdb) {
    try { list = await idbAll() } catch { useIdb = false }
  }
  if (!useIdb) list = lsAll()
  return list.sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, MAX)
}

export async function clearHistory() {
  if (useIdb) { try { await idbClear(); return } catch { useIdb = false } }
  lsClear()
}

// 便捷封装：记录一次成功处理（path=当前路由, name=输出文件名）
// type 由调用方（下载钩子）按扩展名推断后传入，便于"最近处理"按类型筛选；老记录无 type 时回退 'other'
export function recordUsage(path, name, type) {
  return addHistory({ path, name: name || '', type: type || '' })
}

// 「最近使用」与「可恢复任务」分离：clearHistory 只清最近使用，
// 可恢复快照由 resume.js 的 clearResume 独立管理，互不连带删除。
export { clearResume } from './resume.js'
