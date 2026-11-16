// 词典后台线程客户端 —— 装载 / 建索引 / 检索全部发生在 Worker，主线程只收发小消息。
//
// 降级策略：Worker 构造失败（file:// 直开、老浏览器、极端 CSP）或脚本加载失败时，
// 动态 import 内核在主线程执行同一套逻辑——本文件刻意不做静态 import('./dict.js')，
// 避免内核被打进主包；只有真正走降级路径的那次才加载。
//
// 已知边界：若词库经 Worker 装载成功后线程中途死亡（极罕见），本会话内的检索
// 会静默返回 null；重进页面即恢复。不为这种尾部场景维护第二份索引。
export const MODES = ['auto', 'exact', 'prefix', 'pinyin', 'gloss', 'fuzzy']

let worker = null
let workerDead = false // Worker 彻底不可用，后续请求直接走主线程
let seq = 0
const pending = new Map()

function newWorker() {
  try {
    const w = new Worker(new URL('./dict.worker.js', import.meta.url), { type: 'module' })
    w.onmessage = (e) => {
      const { id, ok, payload, error } = e.data || {}
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (ok) p.res(payload)
      else p.rej(new Error(error || '词典线程返回错误'))
    }
    w.onerror = () => {
      // 致命错误（脚本加载失败等）：拒绝全部挂起请求，此后不再尝试 Worker
      workerDead = true
      for (const p of pending.values()) p.rej(new Error('词典线程加载失败'))
      pending.clear()
      try { w.terminate() } catch { /* ignore */ }
      if (worker === w) worker = null
    }
    return w
  } catch {
    return null
  }
}

function call(op, args = {}) {
  if (workerDead) return null
  if (!worker) {
    worker = newWorker()
    if (!worker) { workerDead = true; return null }
  }
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { res: resolve, rej: reject })
    worker.postMessage({ id, op, ...args })
  })
}

/* ---------------- 主线程降级路径（内核懒加载） ---------------- */

let main = null // { index }
const mainLib = () => import('./dict.js')

export async function loadDict(text, name) {
  const r = await call('load', { text, name }).catch(() => null)
  if (r) return { ...r, thread: 'worker' }
  const lib = await mainLib()
  const t0 = performance.now()
  const entries = lib.parseDict(text, name || '')
  if (!entries.length) throw new Error('解析结果为空，请检查词库格式')
  main = { index: lib.buildIndex(entries) }
  return {
    entries: main.index.entries.length,
    words: lib.stats(main.index).words,
    ms: Math.round(performance.now() - t0),
    thread: 'main',
  }
}

export async function dictSearch(q, mode = 'auto', limit = 60) {
  const r = await call('search', { q, mode, limit }).catch(() => null)
  if (r) return { ...r, thread: 'worker' }
  if (!main) return null
  const lib = await mainLib()
  return { ...lib.search(main.index, q, { mode, limit }), thread: 'main' }
}
