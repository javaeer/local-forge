// 新增能力 e2e：PWA（manifest / SW / 离线）、i18n（中英切换/持久化/html lang）、
// 跨工具工作流（NextSteps 渲染 + 传文件）、最近处理按类型筛选。
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const ORIGIN = new URL(BASE).origin
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  // 隔离：以中文为基线（本用例会临时切换语言，结束后恢复）
  await page.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem('lf-e2e-init')) { localStorage.setItem('lf-locale', 'zh-CN'); sessionStorage.setItem('lf-e2e-init', '1') } } catch {} })
  await page.setViewport({ width: 1280, height: 900 })

  /* ================= PWA ================= */
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await wait(800)

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')
    if (!link) return null
    try { return await (await fetch(link.href)).json() } catch { return 'ERR' }
  })
  check('PWA：manifest 链接存在且可解析', manifest && manifest !== 'ERR' && manifest.name, manifest === 'ERR' ? 'fetch err' : (manifest && manifest.short_name))
  check('PWA：manifest 含 192/512 图标', !!manifest && Array.isArray(manifest.icons) && manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512'))
  check('PWA：display = standalone', !!manifest && manifest.display === 'standalone', manifest && manifest.display)

  const iconOk = await page.evaluate(async () => {
    const r192 = await fetch('/icons/icon-192.png')   // 走 SW 缓存路径
    const r512 = await fetch('/icons/icon-512.png')
    return { a: r192.ok, b: r512.ok, ta: r192.headers.get('content-type') || '' }
  })
  check('PWA：应用图标可访问', iconOk.a && iconOk.b, `ct=${iconOk.ta}`)

  // SW 注册（等待 registration 出现）
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw'
    try {
      const reg = await navigator.serviceWorker.ready
      return reg && reg.active ? 'active' : 'no-active'
    } catch { return 'ready-err' }
  })
  check('PWA：Service Worker 已激活', swReady === 'active', swReady)

  // 离线：断开网络后重新加载，外壳应仍能打开（由 SW 提供）
  await page.setOfflineMode(true)
  let offlineOk = false
  let offlineDetail = ''
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
    await wait(600)
    offlineOk = await page.evaluate(() => !!document.querySelector('.app') && !!document.querySelector('#app'))
  } catch (e) { offlineDetail = e.message }
  check('PWA：离线仍可加载应用外壳', offlineOk, offlineDetail)
  await page.setOfflineMode(false)
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(500)

  /* ================= i18n ================= */
  // 默认中文（或英文，取决于 navigator），强制点切换按钮测两端
  const langBefore = await page.evaluate(() => document.documentElement.getAttribute('lang'))
  check('i18n：<html lang> 已设置', !!langBefore, `lang=${langBefore}`)

  // 找到语言切换按钮（顶栏 button[data-testid=locale-toggle]，文案为语言简称）
  const langBtnSel = await page.evaluate(() => !!document.querySelector('.topbar [data-testid=locale-toggle]'))
  check('i18n：顶栏存在语言切换按钮', langBtnSel)

  // 打开语言下拉，切换到 English
  const pickLang = async (name) => {
    await page.evaluate(() => document.querySelector('.topbar [data-testid=locale-toggle]').click())
    await wait(250)
    await page.evaluate((nm) => {
      const item = Array.from(document.querySelectorAll('.lang-menu .lang-item')).find((x) => x.textContent.includes(nm))
      if (item) item.click()
    }, name)
    await wait(350)
  }
  await pickLang('English')
  const langAfter = await page.evaluate(() => ({
    lang: document.documentElement.getAttribute('lang'),
    stored: localStorage.getItem('lf-locale'),
    search: (document.querySelector('.top-search .ts-text') || {}).textContent || '',
  }))
  check('i18n：切换后 <html lang> 变化', langAfter.lang !== langBefore, `${langBefore} → ${langAfter.lang}`)
  check('i18n：语言偏好已持久化', !!langAfter.stored, `lf-locale=${langAfter.stored}`)
  check('i18n：英文文案生效（Search）', /search/i.test(langAfter.search), langAfter.search)

  // 切到日语，验证 <html lang> 与文案
  await pickLang('日本語')
  const ja = await page.evaluate(() => ({
    lang: document.documentElement.getAttribute('lang'),
    stored: localStorage.getItem('lf-locale'),
    search: (document.querySelector('.top-search .ts-text') || {}).textContent || '',
  }))
  check('i18n：可切换到日语', ja.lang === 'ja-JP', `lang=${ja.lang} stored=${ja.stored}`)
  check('i18n：日语文案生效（ツール）', /ツール/.test(ja.search), ja.search)

  // 切回中文并持久化校验
  await pickLang('中文')
  const back = await page.evaluate(() => localStorage.getItem('lf-locale'))
  check('i18n：可切回中文并持久化', back === 'zh-CN', `lf-locale=${back}`)

  /* ================= 跨工具工作流 ================= */
  // 打开图片工具，注入一个 PNG 文件，跑一次压缩，验证结果区出现"下一步"
  await page.goto(BASE + 'image-convert', { waitUntil: 'networkidle0' })
  // 等待懒加载视图与拖放区渲染
  await page.waitForSelector('.dropzone input[type=file]', { timeout: 15000 })
  await wait(400)

  // 构造一张 PNG 注入到隐藏 input
  const injected = await page.evaluate(async () => {
    function makePng() {
      const c = document.createElement('canvas'); c.width = 48; c.height = 48
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#38bdf8'; ctx.fillRect(0, 0, 48, 48)
      ctx.fillStyle = '#a78bfa'; ctx.fillRect(12, 12, 24, 24)
      return new Promise((res) => c.toBlob((b) => res(b), 'image/png'))
    }
    const blob = await makePng()
    const file = new File([blob], 'wf-test.png', { type: 'image/png' })
    const input = document.querySelector('.dropzone input[type=file]')
    if (!input) return 'no-input'
    const dt = new DataTransfer(); dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok'
  })
  check('工作流：测试图片注入成功', injected === 'ok', injected)
  await wait(500)
  // 点"开始"（图片工具按钮文案：开始 / Start）
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.panel .btn')).find((b) => /开始|Start/i.test(b.textContent || ''))
    if (btn) btn.click()
  })
  await wait(1500)
  const ns = await page.evaluate(() => {
    const box = document.querySelector('.next-steps')
    if (!box) return null
    return {
      buttons: Array.from(box.querySelectorAll('.ns-btn')).map((b) => b.textContent.trim()),
    }
  })
  check('工作流：结果区出现「下一步」按钮', !!ns && ns.buttons.length >= 3, ns ? ns.buttons.join(' | ') : 'none')
  check('工作流(图片)含「打包为 ZIP」', !!ns && ns.buttons.some((t) => /打包|ZIP/i.test(t)), ns ? ns.buttons.join(' | ') : '')
  check('工作流(图片)含「生成二维码」', !!ns && ns.buttons.some((t) => /二维码|QR/i.test(t)), ns ? ns.buttons.join(' | ') : '')

  // 点击"生成二维码" → 应跳转 /qr-code 并自动把文本/文件带入
  if (ns && ns.buttons.length) {
    await page.evaluate(() => {
      const box = document.querySelector('.next-steps')
      const btn = Array.from(box.querySelectorAll('.ns-btn')).find((b) => /二维码|QR/i.test(b.textContent))
      if (btn) btn.click()
    })
    await wait(1200)
    const url = page.url()
    check('工作流：跳转到二维码工具', /qr-code/.test(url), url.replace(ORIGIN, ''))
  }

  /* ================= 最近处理 + 类型筛选 ================= */
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await wait(800)
  // 注入若干历史记录（模拟已下载过图片/PDF/压缩包）
  await page.evaluate(async () => {
    const recs = [
      { path: '/image-convert', name: 'a.png', type: 'image', t: Date.now() - 1000 },
      { path: '/pdf-tools', name: 'b.pdf', type: 'pdf', t: Date.now() - 2000 },
      { path: '/zip-compress', name: 'c.zip', type: 'archive', t: Date.now() - 3000 },
      { path: '/media-convert', name: 'd.mp4', type: 'video', t: Date.now() - 4000 },
    ]
    // 优先写 IndexedDB（与 history.js 同库）
    await new Promise((resolve) => {
      const req = indexedDB.open('lf-history', 1)
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id', autoIncrement: true }) }
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('records', 'readwrite')
        const store = tx.objectStore('records')
        recs.forEach((r) => store.add(r))
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      }
      req.onerror = () => resolve()
    })
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(900)
  const recentUI = await page.evaluate(() => {
    const panel = document.querySelector('.recent')
    if (!panel) return null
    const chips = Array.from(panel.querySelectorAll('.chip')).map((c) => c.textContent.trim())
    const items = panel.querySelectorAll('.recent-item').length
    return { chips, items }
  })
  check('历史：最近处理面板可见', !!recentUI, recentUI ? 'ok' : 'missing')
  check('历史：显示全部记录', !!recentUI && recentUI.items >= 4, recentUI ? `items=${recentUI.items}` : '')
  check('历史：出现类型筛选标签', !!recentUI && recentUI.chips.length >= 2, recentUI ? recentUI.chips.join(' | ') : '')

  // 点击"图片"筛选，列表应只剩图片（chip 文案随语言：图片 / Image）
  const filtered = await page.evaluate(async () => {
    const panel = document.querySelector('.recent')
    const chip = Array.from(panel.querySelectorAll('.chip')).find((c) => /图片|Image/i.test(c.textContent))
    if (!chip) return null
    chip.click()
    await new Promise((r) => setTimeout(r, 200))
    const items = Array.from(panel.querySelectorAll('.recent-item')).map((i) => (i.querySelector('.recent-name') || {}).textContent || '')
    return { count: items.length, items }
  })
  check('历史：按「图片」筛选生效', !!filtered && filtered.count >= 1 && filtered.items.every((n) => /\.png$/i.test(n)), filtered ? filtered.items.join(',') : 'no-chip')

} finally {
  await browser.close()
}

console.log(`\n===== 新增能力 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }