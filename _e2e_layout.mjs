// 布局 / 导航 e2e（双布局版）：
// 验证 顶栏(默认) 与 侧栏 两种布局可切换并持久化、侧栏图标窄栏可展开、
// 移动端底部标签栏、命令面板(Ctrl+K)、主题切换、各宽度零横向溢出。
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] })
try {
  const page = await browser.newPage()
  // 隔离：每次导航前固定语言为中文，避免与其它 e2e 相互串扰
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('lf-locale', 'zh-CN') } catch {} })
  const noOverflow = async () => {
    const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }))
    return r.s <= r.w + 1 ? null : `scrollW=${r.s} win=${r.w}`
  }

  // ---------- 桌面 · 默认顶栏布局 ----------
  await page.setViewport({ width: 1280, height: 900 })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 400))

  const d = await page.evaluate(() => {
    const app = document.querySelector('.app')
    const top = document.querySelector('.topbar')
    const nav = document.querySelector('.tb-nav')
    const tabbar = document.querySelector('.tabbar')
    const cs = (el) => (el ? getComputedStyle(el).display : 'null')
    return { layout: app.className, top: cs(top), nav: cs(nav), tabbar: cs(tabbar), links: nav ? nav.querySelectorAll('.tb-link').length : 0 }
  })
  check('桌面默认：布局为顶栏', d.layout.includes('layout-topbar'), d.layout)
  check('桌面默认：顶栏可见且含快捷入口', d.top === 'flex' && d.links >= 6, `links=${d.links}`)
  check('桌面默认：无侧边栏', !d.layout.includes('sidebar-active'), '')
  check('桌面默认：底部标签栏隐藏', d.tabbar === 'none', `tabbar=${d.tabbar}`)
  let o = await noOverflow(); check('桌面默认：无横向溢出', !o, o)

  // 汉堡按钮：顶栏布局没有侧栏，点击应打开「全部工具」命令面板（曾因绑错函数成为死按钮）
  await page.click('.nav-toggle')
  await new Promise((r) => setTimeout(r, 250))
  check('桌面顶栏：汉堡按钮打开命令面板（非死按钮）',
    await page.evaluate(() => !!document.querySelector('.palette')))
  // 键盘：input 与 scrim 曾同时监听 keydown 并冒泡，导致一次按键跳 2 项
  const idxOf = () => page.evaluate(() => [...document.querySelectorAll('.p-item')].findIndex((e) => e.classList.contains('active')))
  const step0 = await idxOf()
  await page.keyboard.press('ArrowDown')
  await new Promise((r) => setTimeout(r, 150))
  const step1 = await idxOf()
  check('命令面板：一次 ArrowDown 只前进 1 项', step1 - step0 === 1, `${step0} → ${step1}`)
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 200))

  // 切换到侧栏布局
  await page.click('[data-testid="layout-toggle"]')
  await new Promise((r) => setTimeout(r, 350))
  const sb = await page.evaluate(() => {
    const s = document.querySelector('.sidebar')
    return { has: !!s, collapsed: s ? s.classList.contains('collapsed') : null, w: s ? Math.round(s.getBoundingClientRect().width) : 0 }
  })
  check('切到侧栏：侧栏出现且默认收起为窄栏', sb.has && sb.collapsed && sb.w <= 60, `width=${sb.w}`)
  const persisted = await page.evaluate(() => localStorage.getItem('lf-layout'))
  check('布局偏好已持久化', persisted === 'sidebar', `lf-layout=${persisted}`)

  // 悬停展开侧栏
  await page.hover('.sidebar')
  await new Promise((r) => setTimeout(r, 350))
  const expanded = await page.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width))
  check('侧栏悬停展开', expanded > 200, `width=${expanded}`)

  // 桌面侧栏布局：汉堡按钮应切换窄栏（原实现绑成了「打开抽屉」，桌面无效果）
  await page.click('.nav-toggle')
  await new Promise((r) => setTimeout(r, 300))
  check('桌面侧栏：汉堡按钮展开窄栏',
    !(await page.evaluate(() => document.querySelector('.sidebar').classList.contains('collapsed'))))
  await page.click('.nav-toggle')
  await new Promise((r) => setTimeout(r, 300))
  check('桌面侧栏：再次点击收起窄栏',
    await page.evaluate(() => document.querySelector('.sidebar').classList.contains('collapsed')))

  // 切回顶栏
  await page.click('[data-testid="layout-toggle"]')
  await new Promise((r) => setTimeout(r, 300))
  const back = await page.evaluate(() => ({ layout: document.querySelector('.app').className, ls: localStorage.getItem('lf-layout') }))
  check('切回顶栏布局', back.layout.includes('layout-topbar') && back.ls === 'topbar', back.layout)

  // 命令面板
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control')
  await new Promise((r) => setTimeout(r, 220))
  check('命令面板：Ctrl+K 打开', await page.evaluate(() => !!document.querySelector('.palette')))
  await page.type('.p-input input', 'ocr'); await new Promise((r) => setTimeout(r, 200))
  const hit = await page.evaluate(() => (document.querySelector('.p-item .p-title') || {}).textContent || '')
  check('命令面板：搜索 ocr 命中', /OCR/i.test(hit), `首条="${hit}"`)
  await page.keyboard.press('Enter'); await new Promise((r) => setTimeout(r, 400))
  const afterPal = await page.evaluate(() => ({ path: location.pathname, open: !!document.querySelector('.palette') }))
  check('命令面板：回车跳转并关闭', afterPal.path === '/ocr' && !afterPal.open, `path=${afterPal.path}`)

  // 主题
  const t0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  await page.click('[data-testid="theme-toggle"]')
  await new Promise((r) => setTimeout(r, 150))
  const t1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  check('主题：切换生效', t0 !== t1, `${t0} → ${t1}`)

  // ---------- 手机 · 顶栏 + 底部标签栏 ----------
  await page.evaluate(() => localStorage.setItem('lf-layout', 'topbar'))
  await page.setViewport({ width: 390, height: 844 })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 400))
  const m = await page.evaluate(() => {
    const tb = document.querySelector('.tabbar')
    const tabs = [...document.querySelectorAll('.tabbar .tab')].map((e) => e.textContent.trim())
    return { tabbar: tb ? getComputedStyle(tb).display : 'none', tabs }
  })
  check('手机：底部标签栏可见', m.tabbar === 'flex', `tabs=${m.tabs.length}`)
  check('手机：标签含"全部"入口', m.tabs.some((t) => t.includes('全部')), m.tabs.join(' | '))
  o = await noOverflow(); check('手机：无横向溢出', !o, o)

  // 点底部标签直达工具（一步）
  await page.click('.tabbar .tab:nth-child(4)')   // 二维码
  await new Promise((r) => setTimeout(r, 400))
  check('手机：底部标签一键直达', (await page.evaluate(() => location.pathname)) === '/qr-code', await page.evaluate(() => location.pathname))

  // 底部"全部"打开命令面板
  await page.click('.tabbar .tab:last-child'); await new Promise((r) => setTimeout(r, 250))
  check('手机：底部"全部"打开命令面板', await page.evaluate(() => !!document.querySelector('.palette')))
  await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 200))

  // 移动端侧栏布局 → 抽屉
  await page.evaluate(() => localStorage.setItem('lf-layout', 'sidebar'))
  await page.goto(BASE, { waitUntil: 'networkidle0' }); await new Promise((r) => setTimeout(r, 350))
  const sbM = await page.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().left))
  check('手机(侧栏布局)：默认离屏', sbM < -10, `left=${sbM}`)
  await page.click('.nav-toggle'); await new Promise((r) => setTimeout(r, 300))
  check('手机(侧栏布局)：点开抽屉', (await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().left)) > -10)
  await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 300))
  check('手机(侧栏布局)：Esc 收起', (await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().left)) < -10)

  // ---------- 平板 ----------
  await page.setViewport({ width: 768, height: 1024 })
  await page.goto(BASE, { waitUntil: 'networkidle0' }); await new Promise((r) => setTimeout(r, 300))
  check('平板：底部标签栏可见', (await page.evaluate(() => getComputedStyle(document.querySelector('.tabbar')).display)) === 'flex')
  o = await noOverflow(); check('平板：无横向溢出', !o, o)
} finally {
  await browser.close()
}

console.log(`\n布局/导航 e2e：${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
