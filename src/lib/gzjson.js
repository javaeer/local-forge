// 静态数据快照的统一加载层。
//
// 古典文学 / 中医药模块的数据都是「构建期生成、gzip 存放、运行时懒加载」
// 的 `.json.gz`，加载逻辑完全相同，此前在 classics.js / citunes.js 里各抄了一份。
// 第 3 期加第三份时收敛到这里，后来全量库与中医药库也共用这一层。
//
// 四条硬要求（都是踩过的坑，改了会坏）：
//
// 1. **兼容两种 gzip 形态。** 静态服务器对 `.gz` 往往直接加 `Content-Encoding: gzip`，
//    浏览器会自动解压，此时拿到的已是明文 JSON。若一口咬定「魔数不是 1f 8b 就是损坏」，
//    在部分 CDN / 本地 preview 上必然失败。所以先看魔数再决定要不要解。
// 2. **识别静态托管的 SPA 回退。** 很多站点配了 `/* /index.html 200`：数据文件没上传时，
//    fetch `/classics/full-index.json.gz` 会拿回 200 的 HTML。直接 JSON.parse 只会报
//    `Unexpected token '<'`，用户完全不知道该干什么。这里统一识别成「数据未发布」。
// 3. **404 也要可执行。** 告诉用户生成命令，并提醒把生成的文件一起上传。
// 4. **真损坏与「没发布」分开报。** 两者修法不同：前者重跑快照，后者重新部署。

export function dataUrl(file) {
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/'
  return `${base}${file}`.replace(/\/{2,}/g, '/')
}

export async function decodeMaybeGzip(buf) {
  const u8 = new Uint8Array(buf)
  const isGz = u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b
  if (!isGz) return new TextDecoder('utf-8').decode(u8)
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))
      return await new Response(stream).text()
    } catch { /* 老浏览器或文件损坏 → 交给 fflate */ }
  }
  const { gunzipSync } = await import('fflate')
  return new TextDecoder('utf-8').decode(gunzipSync(u8))
}

function notDeployedError({ label, url, cmd }) {
  return new Error(
    `${label}未随本次构建发布（${url} 返回的是网页，不是数据文件）。` +
      `请在构建机执行 ${cmd} 生成快照，并将生成的文件（含子目录）一起上传后重新部署。`,
  )
}

function brokenDataError(e, { label, cmd }) {
  return new Error(`${label}数据损坏（${e.message}）。请重新运行 ${cmd} 生成快照`)
}

// 把已下载的字节解析成 JSON。所有 .json.gz 都走这里，避免各处 JSON.parse
// 把静态托管的 SPA 回退页当成数据。
export async function parseGzJson(buf, { label = '数据', cmd = '', url = '', contentType = '' } = {}) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const isGz = u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b
  if (!isGz) {
    const head = new TextDecoder('utf-8').decode(u8.subarray(0, 512))
    const looksLikeHtml = /^\s*(?:<!doctype\b|<html\b)/i.test(head)
    const looksLikeJson = /^\s*[\[{"]/.test(head)
    if (looksLikeHtml || (!looksLikeJson && /text\/html/i.test(contentType))) {
      throw notDeployedError({ label, url, cmd })
    }
  }
  let text
  try {
    text = await decodeMaybeGzip(buf)
  } catch (e) {
    throw brokenDataError(e, { label, cmd })
  }
  try {
    return JSON.parse(text)
  } catch (e) {
    throw brokenDataError(e, { label, cmd })
  }
}

// file: 'classics/rhyme.json.gz'
// cmd : 'npm run classics:fetch'（用于报错时告诉用户怎么修）
export async function fetchGzJson(file, { cmd, label }) {
  const url = dataUrl(file)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `${label}数据不存在（${url}）。请先运行 ${cmd} 生成快照，并确认生成的文件已随站点发布`
        : `${label}加载失败：HTTP ${res.status} ${res.statusText}`,
    )
  }
  const data = await parseGzJson(await res.arrayBuffer(), {
    label,
    cmd,
    url,
    contentType: res.headers?.get?.('content-type') || '',
  })
  return { data, url }
}
