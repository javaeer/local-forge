// 媒体获取（纯前端，100% 浏览器内，零上传）。
//
// 定位：local-forge 已有「媒体转换 / 音视频进阶」（基于 ffmpeg.wasm），本模块补足
// 「把媒体拿到本地」的一环——从直链或用户自托管的桥接服务拉取音视频，并在需要时对
// 分片 / 多文件做本地合并（复用 media.js 的 ffmpeg 管线）。
//
// 隐私与设计取舍：
//   - 不内置任何第三方解析后端。平台解析（B站 / 抖音 / YouTube 等）天然需要服务端，
//     与 local-forge「零上传、无服务器」的初衷冲突；因此解析能力通过「可选桥接地址」
//     解耦——用户若自己跑了一个解析服务，把它填进桥接地址即可，默认留空走「直链模式」。
//   - 直链模式：用户直接粘贴已解析好的媒体 URL（单个或多个，每行一个，支持 .m3u8 分片清单）。
//   - 桥接模式：在直链 URL 前加一层用户自托管的反代 / CORS 代理，绕过浏览器的跨域限制。
//   - 桥接地址持久化在 localStorage，绝不外泄到任何第三方。
import {
  writeMediaFile,
  execMedia,
  unlinkMediaFiles,
  onProgress as mediaOnProgress,
  setCoreLoadHook as mediaSetCoreLoadHook,
  ensureMediaCore,
} from './media.js'

const BRIDGE_KEY = 'lf-md-bridge'

// ---------- 桥接地址（可选 CORS 代理 / 自托管解析服务）----------
export function getBridgeUrl() {
  try {
    return localStorage.getItem(BRIDGE_KEY) || ''
  } catch {
    return ''
  }
}
export function setBridgeUrl(url) {
  const v = (url || '').trim()
  try {
    if (v) localStorage.setItem(BRIDGE_KEY, v)
    else localStorage.removeItem(BRIDGE_KEY)
  } catch { /* 隐私模式等场景忽略 */ }
  return v
}
export function clearBridgeUrl() {
  try { localStorage.removeItem(BRIDGE_KEY) } catch { /* ignore */ }
}

// 把目标 URL 套到桥接地址上：若桥接含 {url} 占位符则替换，否则作为 ?url= 查询参数。
export function applyBridge(bridge, target) {
  const b = (bridge || '').trim()
  if (!b) return target
  if (b.includes('{url}')) return b.replace('{url}', encodeURIComponent(target))
  const sep = b.includes('?') ? '&' : '?'
  return `${b}${sep}url=${encodeURIComponent(target)}`
}

// ---------- 解析输入 ----------
// 把多行输入框拆成 URL 列表（去空、去首尾空白）。
export function parseUrls(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------- 带进度的 Blob 拉取 ----------
// 优先用 ReadableStream 监听下载进度；不支持时退化为一次性 fetch（进度置为不确定）。
// viaBridge=true 时自动套桥接地址。
export async function fetchMediaBlob(url, { onProgress, viaBridge = false } = {}) {
  const finalUrl = viaBridge ? applyBridge(getBridgeUrl(), url) : url
  const res = await fetch(finalUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const total = Number(res.headers.get('content-length')) || 0
  const filename = deriveName(finalUrl, res)
  const reader = res.body && res.body.getReader ? res.body.getReader() : null
  if (!reader) {
    const blob = await res.blob()
    onProgress && onProgress(100)
    return { blob, size: blob.size || total, filename }
  }
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.length
      if (total) onProgress && onProgress(Math.min(99, Math.round((received / total) * 100)))
    }
  }
  const blob = new Blob(chunks)
  onProgress && onProgress(100)
  return { blob, size: blob.size || received, filename }
}

function deriveName(url, res) {
  try {
    const u = new URL(url, location.href)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    if (seg && /\.[a-z0-9]+$/i.test(seg)) return decodeURIComponent(seg)
  } catch { /* ignore */ }
  const cd = res && res.headers && res.headers.get('content-disposition')
  if (cd) {
    const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)
    if (m) return decodeURIComponent(m[1])
  }
  return 'media'
}

// ---------- 本地合并（复用 media.js 的 ffmpeg 管线）----------
// 把多个 Blob（同容器 / 同编码的分片或文件）用 ffmpeg concat 合并为一个。
// 返回合并后的 Blob；失败时抛出（message + stack 由调用方记录）。
export async function mergeParts(parts, outName = 'merged.mp4', outMime = 'video/mp4', { onProgress, onCore } = {}) {
  if (!parts || parts.length < 2) throw new Error('合并至少需要 2 个分片')
  if (onProgress) mediaOnProgress((p) => onProgress(p))
  if (onCore) mediaSetCoreLoadHook((s) => onCore(s))
  const names = []
  for (let i = 0; i < parts.length; i++) {
    const name = `mf_part${i}`
    const buf = new Uint8Array(await parts[i].arrayBuffer())
    await writeMediaFile(name, buf)
    names.push(name)
  }
  const listText = names.map((n) => `file '${n}'`).join('\n')
  await writeMediaFile('mf_list.txt', new TextEncoder().encode(listText))
  try {
    const [out] = await execMedia(
      ['-f', 'concat', '-safe', '0', '-i', 'mf_list.txt', '-c', 'copy', outName],
      [{ name: outName, mime: outMime }],
    )
    return out.blob
  } finally {
    await unlinkMediaFiles([...names, 'mf_list.txt'])
  }
}

// 预览内核是否已就绪（不触发下载，供视图判断能否合并）。
export async function ensureCore() {
  return ensureMediaCore()
}

// ---------- 自检（离线安全，不拉取 WASM / 不联网）----------
export async function selfTest() {
  const items = []
  const add = async (id, title, fn) => {
    try {
      const detail = await fn()
      items.push({ id, title, ok: true, detail })
    } catch (e) {
      items.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } })
    }
  }
  await add('bridge-config', '桥接地址配置可读写', async () => {
    const before = getBridgeUrl()
    setBridgeUrl('https://example.test/bridge')
    const after = getBridgeUrl()
    setBridgeUrl(before)
    if (after !== 'https://example.test/bridge') throw new Error('localStorage 读写异常')
    return before ? `已配置：${before}` : '未配置（直链模式）'
  })
  await add('bridge-apply', '桥接地址拼接逻辑', async () => {
    const a = applyBridge('https://p.test/{url}', 'https://x.test/a.mp4')
    if (!a.includes(encodeURIComponent('https://x.test/a.mp4'))) throw new Error('占位符替换失败')
    const b = applyBridge('https://p.test', 'https://x.test/a.mp4')
    if (!b.startsWith('https://p.test?url=')) throw new Error('查询参数拼接失败')
    return '占位符 / 查询参数均正常'
  })
  await add('media-wiring', 'ffmpeg 管线已接入', async () => {
    if (typeof writeMediaFile !== 'function' || typeof execMedia !== 'function') {
      throw new Error('media.js 导出缺失')
    }
    return 'writeMediaFile / execMedia 可用'
  })
  return { module: '媒体获取', items }
}
