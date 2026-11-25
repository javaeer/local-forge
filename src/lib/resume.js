// 可恢复任务（施工图 T2）：只存"可序列化的设置快照"，绝不存原始文件字节 / File / Blob。
// 与 history.js（最近使用）并存且互不干扰：history 记"返回哪个工具"，resume 记"恢复到什么设置"。
//
// 硬约束（隐私边界）：
//   1. settings 走白名单序列化：只接受 string / number / boolean / null 及由它们组成的数组/对象；
//      任何 File / Blob / ArrayBuffer / 函数 / 循环引用一律剔除（不写入、不报错）。
//   2. File System Access handle 仅在 queryPermission 仍为 granted 时写入；失效则降级为 null，
//      不提示用户重新授权。
//   3. TTL 默认 7 天，读取时自动剔除过期项；settings 超过 8KB 拒绝写入。
//   4. 用户可一键清空全部 resume 记录。
const LS_KEY = 'lf-resume-v1'
const TTL_DAYS = 7
const MAX_SETTINGS_BYTES = 8 * 1024

// ---------- 白名单序列化 ----------
function isPlainValue(v, depth = 0) {
  if (depth > 12) return false
  if (v === null) return true
  const t = typeof v
  if (t === 'string' || t === 'boolean') return true
  if (t === 'number') return Number.isFinite(v)
  if (t !== 'object') return false // function / symbol / undefined 一律拒绝
  // 关键：File / Blob / ArrayBuffer / TypedArray / Date / Map / Set 等一律不入库
  if (typeof File !== 'undefined' && v instanceof File) return false
  if (typeof Blob !== 'undefined' && v instanceof Blob) return false
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(v)) return false
  if (v instanceof ArrayBuffer) return false
  if (Array.isArray(v)) return v.every((x) => isPlainValue(x, depth + 1))
  const proto = Object.getPrototypeOf(v)
  if (proto !== null && proto !== Object.prototype) return false
  return Object.values(v).every((x) => isPlainValue(x, depth + 1))
}

// 递归剔除非法值（而非整体丢弃），保证设置快照尽量可用又绝不夹带文件字节。
function sanitize(value, depth = 0) {
  if (depth > 12) return undefined
  if (Array.isArray(value)) return value.map((x) => sanitize(x, depth + 1)).filter((x) => x !== undefined)
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== null && proto !== Object.prototype) return undefined
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      const s = sanitize(v, depth + 1)
      if (s !== undefined) out[k] = s
    }
    return out
  }
  return isPlainValue(value, depth) ? value : undefined
}

function byteLength(obj) {
  try { return new TextEncoder().encode(JSON.stringify(obj)).length } catch { return Infinity }
}

// ---------- File System Access 权限校验 ----------
// 只接受权限仍为 granted 的 handle；任何异常/拒绝都降级为 null，不打扰用户。
export async function safeHandleRef(handle) {
  if (!handle) return null
  try {
    if (typeof handle.queryPermission !== 'function') return null
    const p = await handle.queryPermission({ mode: 'readwrite' })
    return p === 'granted' ? handle : null
  } catch { return null }
}

// ---------- 存储 ----------
function readAll() {
  try {
    const list = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    if (!Array.isArray(list)) return []
    const now = Date.now()
    return list.filter((r) => r && typeof r === 'object' && now - (r.updatedAt || 0) < TTL_DAYS * 86400000)
  } catch { return [] }
}
function writeAll(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch { /* 容量满/隐私模式：静默降级 */ }
}

// 写入/更新一个可恢复快照。settings 非普通对象或超限时返回 false，不写入。
export function saveResume({ toolId, route, settings = {}, progress = 0, fileHandleRef = null, downloadRef = null }) {
  if (!toolId || !route) return false
  const clean = sanitize(settings)
  if (!clean || typeof clean !== 'object') return false
  if (byteLength(clean) > MAX_SETTINGS_BYTES) return false
  const list = readAll()
  const now = Date.now()
  const record = {
    id: `${toolId}::${Date.now()}`,
    toolId,
    route,
    settings: clean,
    createdAt: now,
    updatedAt: now,
    progress: typeof progress === 'number' && progress >= 0 && progress <= 1 ? progress : 0,
    fileHandleRef: fileHandleRef && typeof fileHandleRef === 'object' ? fileHandleRef : null,
    downloadRef: downloadRef && typeof downloadRef === 'object' ? downloadRef : null,
    ttlDays: TTL_DAYS,
  }
  // 同一工具只保留最新一条快照，避免无限累积。
  const kept = list.filter((r) => r.toolId !== toolId)
  kept.push(record)
  writeAll(kept)
  return true
}

// 读取某工具的快照（自动过滤 TTL 过期）。
export function getResume(toolId) {
  return readAll().find((r) => r.toolId === toolId) || null
}

// 全部有效快照（最近更新优先）。
export function listResume() {
  return readAll().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

// 是否存在该任务的快照（供任务卡"可恢复"徽标用）。
export function hasResume(toolId) { return !!getResume(toolId) }

// 更新进度（仅 0..1 的本地队列进度）。
export function updateProgress(toolId, progress) {
  const list = readAll()
  const rec = list.find((r) => r.toolId === toolId)
  if (!rec) return false
  rec.progress = typeof progress === 'number' && progress >= 0 && progress <= 1 ? progress : 0
  rec.updatedAt = Date.now()
  writeAll(list)
  return true
}

// 一键清空全部可恢复快照（与"最近使用"历史分离，不影响 history.js）。
export function clearResume() { writeAll([]) }

// 供测试/自检：序列化白名单是否接受该值（不实际写入）。
export function isSerializable(value) { return isPlainValue(value) }
export { TTL_DAYS, MAX_SETTINGS_BYTES, LS_KEY }
