// 离线内核管理（A-3）。与 public/sw.js 通过 postMessage 通信：
//  - precacheCores(groups) → 让 SW 把指定内核组拉进 CORE_CACHE
//  - coreStatus()          → 查询各内核组已缓存情况
//  - clearCores()          → 清空内核缓存
// 页面无需自己 fetch 大文件，进度由 SW 的 PRECACHE_PROGRESS 回传。

export const CORE_GROUPS_META = [
  { id: 'archive', label: '压缩 / 解压', size: '约 1 MB' },
  { id: 'dict', label: '离线词典词库（汉英）', size: '约 5.5 MB' },
  { id: 'dict-en', label: '英汉大词库 ECDICT', size: '约 19 MB' },
  { id: 'pdf', label: 'PDF 解析内核', size: '约 1.3 MB' },
  { id: 'ocr', label: 'OCR 识别内核', size: '约 13 MB' },
  { id: 'ocr-lang', label: 'OCR 语言包（9 种语言）', size: '约 16 MB' },
  { id: 'media', label: '音视频转换（多线程）', size: '约 31 MB' },
  { id: 'media-st', label: '音视频转换（单线程兜底）', size: '约 31 MB' },
]

export function swSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

async function getReg() {
  if (!swSupported()) return null
  try { return await navigator.serviceWorker.ready } catch { return null }
}

// 统一的"发消息并等回包"辅助：按 type 过滤，超时兜底。
function requestOnce(reg, message, waitType, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const sw = reg.active || navigator.serviceWorker.controller
    if (!sw) { resolve(null); return }
    let done = false
    const onMsg = (e) => {
      if (e.data && e.data.type === waitType) {
        done = true
        navigator.serviceWorker.removeEventListener('message', onMsg)
        resolve(e.data)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    sw.postMessage(message)
    setTimeout(() => {
      if (!done) { navigator.serviceWorker.removeEventListener('message', onMsg); resolve(null) }
    }, timeoutMs)
  })
}

// 主动预缓存：onProgress(payload) 收到 { done, total, bytes }。返回最终统计。
export async function precacheCores(groups, onProgress) {
  const reg = await getReg()
  if (!reg) return null
  const progressHandler = (e) => {
    if (e.data && e.data.type === 'PRECACHE_PROGRESS' && onProgress) onProgress(e.data)
  }
  navigator.serviceWorker.addEventListener('message', progressHandler)
  try {
    return await requestOnce(reg, { type: 'PRECACHE_CORES', groups }, 'PRECACHE_DONE')
  } finally {
    navigator.serviceWorker.removeEventListener('message', progressHandler)
  }
}

export async function coreStatus() {
  const reg = await getReg()
  if (!reg) return null
  const res = await requestOnce(reg, { type: 'CORE_STATUS' }, 'CORE_STATUS', 10000)
  return res ? res.groups : null
}

export async function clearCores() {
  const reg = await getReg()
  if (!reg) return null
  return requestOnce(reg, { type: 'CLEAR_CORES' }, 'CORES_CLEARED', 10000)
}

// 汇总：是否已有任何内核被缓存（用于首页"离线就绪"徽标）
export async function offlineReady() {
  const groups = await coreStatus()
  if (!groups) return false
  return Object.values(groups).some((g) => g.ready)
}
