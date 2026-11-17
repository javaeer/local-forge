// A-3 离线预缓存 e2e：验证 Service Worker 的 PRECACHE_CORES / CORE_STATUS / CLEAR_CORES 协议，
// 以及首页「离线内核」面板的交互与进度回显。
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('lf-locale', 'zh-CN') } catch {} })
  await page.setViewport({ width: 1280, height: 1000 })

  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await wait(900)

  /* 1) SW 就绪 */
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw'
    const reg = await navigator.serviceWorker.ready
    return reg && reg.active ? 'active' : 'none'
  })
  check('A3：Service Worker 已激活', swReady === 'active', swReady)

  /* 2) 离线内核面板渲染 */
  const panel = await page.evaluate(() => {
    const el = document.querySelector('.offline')
    if (!el) return null
    return {
      title: (el.querySelector('h3') || {}).textContent.trim(),
      cards: el.querySelectorAll('.card').length,
      hasFetchAll: !!Array.from(el.querySelectorAll('button')).find((b) => /全部下载|Download all/i.test(b.textContent)),
    }
  })
  check('A3：首页「离线内核」面板可见', !!panel, panel ? panel.title : 'missing')
  check('A3：展示 8 个内核组（解压/词典汉英/英汉ECDICT/PDF/OCR/OCR语言包/媒体/媒体ST）', !!panel && panel.cards === 8, panel ? `cards=${panel.cards}` : '')
  check('A3：存在「全部下载」按钮', !!panel && panel.hasFetchAll)

  /* 3) 初始状态：尚无任何内核缓存 */
  const status0 = await page.evaluate(() => new Promise((resolve) => {
    const handler = (e) => {
      if (e.data && e.data.type === 'CORE_STATUS') {
        navigator.serviceWorker.removeEventListener('message', handler)
        resolve(e.data.groups)
      }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    const sw = navigator.serviceWorker.controller
    if (!sw) { resolve(null); return }
    sw.postMessage({ type: 'CORE_STATUS' })
    setTimeout(() => resolve(null), 5000)
  }))
  check('A3：初始无内核被缓存', !!status0 && Object.values(status0).every((g) => !g.ready),
    status0 ? Object.entries(status0).map(([k, v]) => `${k}:${v.cached}/${v.total}`).join(' ') : 'null')

  /* 4) 触发预缓存「解压」组（最小，约 1MB），验证进度 + 完成后就绪 */
  const fetchResult = await page.evaluate(() => new Promise((resolve) => {
    const sw = navigator.serviceWorker.controller
    if (!sw) { resolve(null); return }
    let lastProg = null
    const onMsg = (e) => {
      if (e.data && e.data.type === 'PRECACHE_PROGRESS') lastProg = e.data
      if (e.data && e.data.type === 'PRECACHE_DONE') {
        navigator.serviceWorker.removeEventListener('message', onMsg)
        resolve({ done: e.data.done, total: e.data.total, bytes: e.data.bytes, lastProg })
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    sw.postMessage({ type: 'PRECACHE_CORES', groups: ['archive'] })
    setTimeout(() => resolve(null), 30000)
  }))
  check('A3：预缓存「解压」组完成', !!fetchResult && fetchResult.done === fetchResult.total && fetchResult.total > 0,
    fetchResult ? `done=${fetchResult.done}/${fetchResult.total} bytes=${fetchResult.bytes}` : 'timeout')
  check('A3：预缓存过程回传进度', !!fetchResult && !!fetchResult.lastProg,
    fetchResult && fetchResult.lastProg ? `phase=${fetchResult.lastProg.phase}` : '')

  /* 5) 状态复查：解压组应就绪 */
  const status1 = await page.evaluate(() => new Promise((resolve) => {
    const handler = (e) => {
      if (e.data && e.data.type === 'CORE_STATUS') {
        navigator.serviceWorker.removeEventListener('message', handler)
        resolve(e.data.groups)
      }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    navigator.serviceWorker.controller.postMessage({ type: 'CORE_STATUS' })
    setTimeout(() => resolve(null), 5000)
  }))
  check('A3：解压组状态变为「就绪」', !!status1 && status1.archive && status1.archive.ready,
    status1 ? `archive=${status1.archive.cached}/${status1.archive.total}` : 'null')

  /* 6) 真·离线：断网后内核文件仍可从缓存取得 */
  await page.setOfflineMode(true)
  const offlineFetch = await page.evaluate(async () => {
    try {
      const r = await fetch('/libarchive/libarchive.wasm')
      return { ok: r.ok, size: (await r.arrayBuffer()).byteLength }
    } catch (e) { return { ok: false, err: String(e) } }
  })
  check('A3：断网后内核仍可用（来自 SW 缓存）', offlineFetch.ok && offlineFetch.size > 0,
    offlineFetch.ok ? `${(offlineFetch.size / 1048576).toFixed(1)} MB` : offlineFetch.err)
  await page.setOfflineMode(false)

  /* 7) 清空缓存 → 状态归零 */
  const cleared = await page.evaluate(() => new Promise((resolve) => {
    const handler = (e) => {
      if (e.data && e.data.type === 'CORES_CLEARED') { navigator.serviceWorker.removeEventListener('message', handler); resolve(true) }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CORES' })
    setTimeout(() => resolve(false), 5000)
  }))
  check('A3：清空内核缓存返回确认', cleared === true)

  const status2 = await page.evaluate(() => new Promise((resolve) => {
    const handler = (e) => {
      if (e.data && e.data.type === 'CORE_STATUS') { navigator.serviceWorker.removeEventListener('message', handler); resolve(e.data.groups) }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    navigator.serviceWorker.controller.postMessage({ type: 'CORE_STATUS' })
    setTimeout(() => resolve(null), 5000)
  }))
  check('A3：清空后所有组归零', !!status2 && Object.values(status2).every((g) => g.cached === 0),
    status2 ? Object.entries(status2).map(([k, v]) => `${k}:${v.cached}`).join(' ') : 'null')

  /* 8) 面板按钮交互（点「下载」后卡片进入下载中/就绪态） */
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(700)
  const clicked = await page.evaluate(() => {
    const el = document.querySelector('.offline')
    const card = el && el.querySelector('.card')
    const btn = card && card.querySelector('button')
    if (!btn) return false
    btn.click()
    return true
  })
  check('A3：面板「下载」按钮可点击', clicked === true)
  await wait(2500)
  const afterClick = await page.evaluate(() => {
    const el = document.querySelector('.offline')
    // 至少一张卡显示进度条或就绪
    return { hasProg: !!el.querySelector('.prog'), readyCards: el.querySelectorAll('.card.ready').length }
  })
  check('A3：点击后出现进度或就绪态', afterClick.hasProg || afterClick.readyCards >= 1,
    `prog=${afterClick.hasProg} ready=${afterClick.readyCards}`)

} finally {
  await browser.close()
}

console.log(`\n===== A-3 离线预缓存 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }