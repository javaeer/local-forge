// pdf.js worker 的统一解析器：本地打包优先，失败时回退 CDN。
//
// 为什么需要这一层：
//   Vite 的 `?url` 导入会把 pdf.worker.min.mjs 作为静态资源打包，workerSrc 指向本地文件。
//   但在**有单文件大小上限的免费主机**（如 InfinityFree：JS/其他文件 10MB、.js 后缀 1MB）上，
//   这个 1.3MB 的 .mjs worker 可能被服务器静默删除，导致 pdf.js 解析直接失败。
//
//   策略：优先用本地 worker（离线可用、无外部依赖）；若本地不可用（文件缺失/加载失败），
//   自动回退到与安装版本严格一致的 jsDelivr CDN worker，保证 PDF 功能不因主机限制而残废。
import * as pdfjs from 'pdfjs-dist'
import localWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// 从 pdfjs-dist 自身版本推导 CDN 地址，避免版本漂移导致 worker 与主库不匹配。
const PDFJS_VERSION = pdfjs.version || '4.10.38'
const CDN_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`

let applied = null

// 探测本地 worker 是否真实可达（HEAD 请求，避免把 HTML 兜底页当成可用文件）。
async function localWorkerUsable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) return false
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    // 被 SPA 回退成 HTML、或 MIME 明显不对 → 视为不可用
    if (ct.includes('text/html')) return false
    const len = Number(res.headers.get('content-length') || 0)
    // 兜底页通常很小；正常 worker 体积在 1MB 量级
    if (len && len < 10240) return false
    return true
  } catch {
    return false
  }
}

/**
 * 为 pdf.js 配置 workerSrc，返回实际采用的来源标签。
 * 幂等：同一页面重复调用只探测一次。
 */
export async function ensurePdfWorker() {
  if (applied) return applied
  if (await localWorkerUsable(localWorkerUrl)) {
    pdfjs.GlobalWorkerOptions.workerSrc = localWorkerUrl
    applied = 'local'
  } else {
    pdfjs.GlobalWorkerOptions.workerSrc = CDN_WORKER
    applied = 'cdn'
  }
  return applied
}

export function pdfWorkerSourceLabel() {
  return applied === 'cdn' ? 'CDN worker' : applied === 'local' ? '本地 worker' : ''
}

export { pdfjs }
