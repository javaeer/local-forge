// 静态数据快照的统一加载层。
//
// 古典文学模块的三份数据（韵书 / 词谱 / 精选库）都是「构建期生成、gzip 存放、运行时懒加载」
// 的 `.json.gz`，加载逻辑完全相同，此前在 classics.js / citunes.js 里各抄了一份。
// 第 3 期加第三份时收敛到这里，三处共用。
//
// 两条硬要求（都是踩过的坑，改了会坏）：
//
// 1. **兼容两种 gzip 形态。** 静态服务器对 `.gz` 往往直接加 `Content-Encoding: gzip`，
//    浏览器会自动解压，此时拿到的已是明文 JSON。若一口咬定「魔数不是 1f 8b 就是损坏」，
//    在部分 CDN / 本地 preview 上必然失败。所以先看魔数再决定要不要解。
// 2. **解压失败要给出可执行的提示。** 用户看到的不能是 `Unexpected token <`，
//    而应是「数据文件可能损坏，请重新运行 npm run xxx:fetch」。

export function dataUrl(file) {
  const base = import.meta.env.BASE_URL || '/'
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

// file: 'classics/rhyme.json.gz'
// cmd : 'npm run classics:fetch'（用于报错时告诉用户怎么修）
export async function fetchGzJson(file, { cmd, label }) {
  const url = dataUrl(file)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `${label}数据不存在（${url}）。请先运行 ${cmd} 生成快照`
        : `${label}加载失败：HTTP ${res.status} ${res.statusText}`,
    )
  }
  const text = await decodeMaybeGzip(await res.arrayBuffer())
  try {
    return { data: JSON.parse(text), url }
  } catch (e) {
    // 既不是合法 gzip 也不是合法 JSON，基本可判定下载不完整
    throw new Error(`${label}数据损坏（${e.message}）。请重新运行 ${cmd}`)
  }
}
