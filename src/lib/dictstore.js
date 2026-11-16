// 自定义词库持久化 —— IndexedDB，与 history.js 同一策略：
// IDB 优先（词库文本可达数 MB，localStorage 的 5MB 配额装不下），
// 不可用（隐私模式 / 老浏览器）时降级为「仅本次会话」的内存态，不报错、不阻塞。
const DB_NAME = 'lf-dict'
const STORE = 'lexicons'
const MAX = 5 // 最多保留 5 份，超出淘汰最旧的一份

let dbPromise = null
let memoryOnly = false
const mem = new Map()

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no-idb')); return }
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

// 打开一个事务、对 store 执行 methodName（'getAll' / 'clear' 等），等事务完成
async function withStore(mode, methodName) {
  const db = await openDB()
  const t = db.transaction(STORE, mode)
  const out = await request(t.objectStore(STORE)[methodName]())
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(out)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

function sortNewestFirst(list) {
  return list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
}

function trimMem() {
  for (const r of sortNewestFirst([...mem.values()]).slice(MAX)) mem.delete(r.id)
}

/* ---------------- 对外 API ---------------- */

export async function saveLexicon({ name, text, count }) {
  const rec = { id: 'lx-' + Date.now().toString(36), name, text, count, addedAt: Date.now() }
  if (!memoryOnly) {
    try {
      const db = await openDB()
      const t = db.transaction(STORE, 'readwrite')
      const store = t.objectStore(STORE)
      store.put(rec)
      store.count().onsuccess = (e) => {
        if (e.target.result > MAX) {
          // 超出上限：按 addedAt 淘汰最旧的（不含刚写入的这份）
          request(store.getAll()).then((all) => {
            for (const old of sortNewestFirst(all || []).slice(MAX)) store.delete(old.id)
          })
        }
      }
      await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error) })
      return { ...rec, persisted: true }
    } catch {
      memoryOnly = true
      dbPromise = null
    }
  }
  mem.set(rec.id, rec)
  trimMem()
  return { ...rec, persisted: false }
}

export async function listLexicons() {
  if (!memoryOnly) {
    try {
      const all = await withStore('readonly', 'getAll')
      return sortNewestFirst(all || [])
    } catch {
      memoryOnly = true
      dbPromise = null
    }
  }
  return sortNewestFirst([...mem.values()])
}

export async function deleteLexicon(id) {
  if (!memoryOnly) {
    try {
      const db = await openDB()
      const t = db.transaction(STORE, 'readwrite')
      t.objectStore(STORE).delete(id)
      await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error) })
      return
    } catch {
      memoryOnly = true
      dbPromise = null
    }
  }
  mem.delete(id)
}
