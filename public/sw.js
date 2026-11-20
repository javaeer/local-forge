/*
 * LocalForge Service Worker —— 让"纯本地/离线"成为可感知的产品能力。
 *
 * 策略总览：
 *  - 导航请求（HTML）：network-first，失败回退缓存 /index.html（SPA 单页应用）
 *  - WASM 内核（ffmpeg / tesseract / libarchive，路径含 /ffmpeg /tesseract /libarchive）：
 *      cache-first —— 带内容版本路径、几乎不变、体积大，一次缓存长期复用；
 *      同时支持页面通过 postMessage({type:'PRECACHE_CORES'}) 主动预缓存（真·离线）。
 *  - 其他同源 GET（JS/CSS/字体/图标）：stale-while-revalidate（先缓存后更新）
 *  - 非 GET / 跨源：直接放行（不缓存、不干预）
 *
 * A-3 升级点：
 *  - 新增 'PRECACHE_CORES' / 'CLEAR_CORES' / 'CORE_STATUS' 三类消息，
 *    页面可按需把指定内核拉进 CORE_CACHE，并可查询已缓存情况。
 *  - 预缓存过程通过 'PRECACHE_PROGRESS' 回传进度（已下载字节 / 总数）。
 *
 * 公众号排版（/wechat-article）说明：
 *  - wechat.js / wechat-extra.js 是零依赖纯 JS 内核，产物是懒加载 JS chunk，
 *    由上面的 stale-while-revalidate 自动缓存，首次访问后即可断网使用；
 *  - 它不依赖任何 WASM 内核，因此不列入 CORE_GROUPS（零内核 = 天然离线），
 *    'CORE_STATUS' 响应里以 offlineNative 字段显式声明这一事实。
 */
const VERSION = 'lf-v2'
const SHELL_CACHE = VERSION + '-shell'
const ASSET_CACHE = VERSION + '-assets'
const CORE_CACHE = VERSION + '-cores'

const CORE_URL_RE = /\/(ffmpeg|ffmpeg-st|tesseract|libarchive|pdfjs)\//

// 零 WASM 内核依赖、首次访问后即可离线使用的工具（声明式，供 CORE_STATUS 上报）
const OFFLINE_NATIVE_TOOLS = [
  '/wechat-article',
  '/dictionary',
  '/classics',
  '/poem-meter',
  '/ci-meter',
  '/tcmchants',
  '/bencao',
  '/tcmbooks',
]

// 预缓存：应用外壳（构建产物由运行时 stale-while-revalidate 覆盖）
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
]

// 模块化数据快照的分片清单（与 scripts/fetch-poems-full.mjs / fetch-tcmbooks.mjs 的产物一致）。
// 放在这里而不是各页面：首页「离线内核」要能一次性把这些资源纳入预缓存与状态统计。
const CLASSICS_SHARDS = Array.from({ length: 46 }, (_, i) => `/classics/full/s${i}.json.gz`)
const TCM_SHARDS = Array.from({ length: 17 }, (_, i) => `/tcm/full/s${i}.json.gz`)

// 内核清单：逻辑分组 → 需要预缓存的文件 URL。页面按 group 触发预缓存。
// 注：ffmpeg-st 属于兜底内核，默认不在"媒体"组里，单独按需（详见 lib/media.js 分级兜底）。
const CORE_GROUPS = {
  archive: ['/libarchive/libarchive.wasm', '/libarchive/worker-bundle.js'],
  dict: [
    '/dict/cc-cedict.txt.gz',
    '/dict/en-ipa-us.txt.gz',
    '/dict/en-ipa-uk.txt.gz',
  ],
  // ECDICT 英汉/英英双解大词库（约 77 万条，~19MB gzip）。单独成组：
  // 体积比主词库大不少，用户可按需选择是否缓存。
  'dict-en': ['/dict/ecdict.csv.gz'],
  ocr: [
    '/tesseract/worker.min.js',
    '/tesseract/tesseract-core-simd-lstm.wasm.js',
    '/tesseract/tesseract-core-simd-lstm.wasm',
    '/tesseract/tesseract-core-lstm.wasm.js',
    '/tesseract/tesseract-core-lstm.wasm',
  ],
  // OCR 语言训练数据（9 种语言，约 16MB，4.0.0_best_int 量化模型）。
  // 与识别内核分开成组：内核小、语言包相对大，用户可只缓存用得上的部分粒度。
  'ocr-lang': [
    '/tesseract/lang/eng.traineddata.gz',
    '/tesseract/lang/chi_sim.traineddata.gz',
    '/tesseract/lang/chi_tra.traineddata.gz',
    '/tesseract/lang/jpn.traineddata.gz',
    '/tesseract/lang/kor.traineddata.gz',
    '/tesseract/lang/fra.traineddata.gz',
    '/tesseract/lang/deu.traineddata.gz',
    '/tesseract/lang/spa.traineddata.gz',
    '/tesseract/lang/rus.traineddata.gz',
  ],
  // pdf.js worker：pdfworker.js 优先使用稳定路径 /pdfjs/（fetch-wasm 从 node_modules 复制），
  // 使 PDF 工具 / PDF 转 OCR 也能真正离线（带 hash 的打包资源名无法静态登记）。
  pdf: ['/pdfjs/pdf.worker.min.mjs'],
  media: ['/ffmpeg/ffmpeg-core.js', '/ffmpeg/ffmpeg-core.wasm', '/ffmpeg/ffmpeg-core.worker.js'],
  'media-st': ['/ffmpeg-st/ffmpeg-core.js', '/ffmpeg-st/ffmpeg-core.wasm'],

  // 离线数据包（B-4 延伸）：原本散落在各模块按需加载的 .json.gz 统一聚合到这里。
  // 页面清单在 src/lib/offline.js 的 CORE_GROUPS_META，两处 id 必须一一对应。
  // 注意：这些快照不进 Git；缺文件时 precacheCores 会跳过，CORE_STATUS 显示未就绪，
  // 正好把「构建机忘了生成/上传」暴露在首页，而不是等到下载时才报 JSON 解析错。
  classics: [
    '/classics/rhyme.json.gz',
    '/classics/citunes.json.gz',
    '/classics/poems.json.gz',
  ],
  'classics-full': ['/classics/full-index.json.gz', ...CLASSICS_SHARDS],
  tcm: [
    '/tcm/tcmchants.json.gz',
    '/tcm/bencao-index.json.gz',
    '/tcm/bencao.json.gz',
    '/tcm/full-index.json.gz',
    ...TCM_SHARDS,
  ],
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

// ---- 主动预缓存内核（真·离线）----
async function precacheCores(groups, client) {
  const cache = await caches.open(CORE_CACHE)
  const urls = [...new Set(groups.flatMap((g) => CORE_GROUPS[g] || []))]
  let done = 0
  let bytes = 0
  const report = (phase) => {
    if (client) client.postMessage({ type: 'PRECACHE_PROGRESS', phase, done, total: urls.length, bytes })
  }
  report('start')
  for (const url of urls) {
    try {
      const hit = await cache.match(url)
      if (!hit) {
        const res = await fetch(url, { cache: 'no-cache' })
        if (res.ok) {
          await cache.put(url, res.clone())
          bytes += Number(res.headers.get('content-length')) || 0
        }
      } else {
        bytes += Number(hit.headers.get('content-length')) || 0
      }
    } catch (err) {
      // 单个文件失败不影响整体；离线可用性以最终 CORE_STATUS 为准
    }
    done++
    report('progress')
  }
  report('done')
  return { done, total: urls.length, bytes }
}

async function coreStatus() {
  const cache = await caches.open(CORE_CACHE)
  const groups = {}
  for (const [g, urls] of Object.entries(CORE_GROUPS)) {
    let hit = 0
    for (const u of urls) if (await cache.match(u)) hit++
    groups[g] = { cached: hit, total: urls.length, ready: hit === urls.length }
  }
  return groups
}

self.addEventListener('message', (e) => {
  const data = e.data || {}
  const client = e.source
  if (data.type === 'PRECACHE_CORES') {
    // 只跑一次：进度通过 PRECACHE_PROGRESS 回传，结束后发 PRECACHE_DONE。
    precacheCores(data.groups || [], client)
      .then((r) => client && client.postMessage({ type: 'PRECACHE_DONE', ...r }))
      .catch((err) => client && client.postMessage({ type: 'PRECACHE_DONE', error: String(err) }))
  } else if (data.type === 'CLEAR_CORES') {
    caches.delete(CORE_CACHE).then(() => client && client.postMessage({ type: 'CORES_CLEARED' }))
  } else if (data.type === 'CORE_STATUS') {
    coreStatus().then((groups) => client && client.postMessage({ type: 'CORE_STATUS', groups, offlineNative: OFFLINE_NATIVE_TOOLS }))
  } else if (data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // 跨源（如 P2P 信令 / CDN 内核）不干预

  // 1) WASM 内核：cache-first
  if (CORE_URL_RE.test(url.pathname)) {
    e.respondWith(
      caches.open(CORE_CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      })
    )
    return
  }

  // 2) 导航请求：network-first → 回退 index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // 顺手更新外壳
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE)
          return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error()
        })
    )
    return
  }

  // 3) 其他同源静态资源：先认显式预缓存（CORE_CACHE，词典与诗文/中医数据包都在这里），
  //    未命中再走 stale-while-revalidate 的 ASSET_CACHE。
  //    早期版本只查 ASSET_CACHE，导致首页点「下载」预缓存了词库/数据，断网却读不到——
  //    这里必须双查，否则 CORE_GROUPS 对这些非 WASM 资源只是"假离线就绪"。
  e.respondWith(
    (async () => {
      const coreCache = await caches.open(CORE_CACHE)
      const coreHit = await coreCache.match(req)
      if (coreHit) return coreHit

      const cache = await caches.open(ASSET_CACHE)
      const hit = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone())
          return res
        })
        .catch(() => hit) // 离线时回退缓存
      return hit || network
    })()
  )
})
