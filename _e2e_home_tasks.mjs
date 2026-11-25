// 首页任务化 e2e：任务卡渲染 / 直达路由 / 工序折叠 / 命令面板 CTA / 五语切换 / 零跨域。
import puppeteer from 'puppeteer-core'
import { TOOL_COUNT } from './src/lib/formats.js'

const BASE = process.env.BASE || 'http://127.0.0.1:4173/'
const ORIGIN = new URL(BASE).origin
const RE_KEY_LEAK = /\btask\.[a-z]/i
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
  try { await page.setBypassServiceWorker(true) } catch { /* 老版本 Puppeteer 不提供 */ }
  await page.setViewport({ width: 1360, height: 1000 })
  const crossOrigin = []
  page.on('request', (req) => {
    try {
      const u = new URL(req.url())
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        if (u.origin !== ORIGIN) crossOrigin.push(u.href)
      }
    } catch { /* data/blob/about 忽略 */ }
  })

  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.evaluate(() => { try { localStorage.setItem('lf-locale', 'zh-CN') } catch {} })
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(450)

  /* 1) 任务入口首屏 */
  const board = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.taskboard .task-card'))
    return {
      count: cards.length,
      ids: cards.map((c) => c.getAttribute('data-task')),
      steps: cards.map((c) => c.querySelectorAll('.task-step').length),
      titles: cards.map((c) => (c.querySelector('h2') || {}).textContent.trim()),
      quicks: document.querySelectorAll('.taskboard .task-quick [data-cta]').length,
    }
  })
  check('任务化：首屏 4 张任务卡', board.count === 4, `count=${board.count}`)
  check('任务化：任务 id 顺序正确', board.ids.join(',') === 'pack,convert,extract,knowledge', board.ids.join(','))
  check('任务化：每张卡至少 3 道工序', board.steps.every((n) => n >= 3), board.steps.join('/'))
  check('任务化：任务标题非原始 key', board.titles.every((s) => !RE_KEY_LEAK.test(s)), board.titles.join(' | '))
  check('任务化：3 个快捷入口存在', board.quicks === 3, `quicks=${board.quicks}`)

  /* 2) 工序区默认收起，展开后全部工序卡可见 */
  const details0 = await page.evaluate(() => {
    const d = document.querySelector('details#all-tools')
    return d ? { open: d.open, summary: (d.querySelector('summary') || {}).textContent.trim(), cards: d.querySelectorAll('.tool-card').length } : null
  })
  check('任务化：全部工序默认收起', !!details0 && !details0.open, details0 ? `open=${details0.open}` : 'missing')
  check(`任务化：折叠区仍保留 ${TOOL_COUNT} 张工序卡`, !!details0 && details0.cards === TOOL_COUNT, details0 ? `cards=${details0.cards}` : '')
  check('任务化：折叠标题走 i18n', !!details0 && !RE_KEY_LEAK.test(details0.summary), details0 ? details0.summary : '')
  await page.evaluate(() => document.querySelector('details#all-tools summary').click())
  await wait(220)
  const opened = await page.evaluate(() => {
    const d = document.querySelector('details#all-tools')
    const cards = Array.from(d.querySelectorAll('.tool-card'))
    return { open: d.open, visible: cards.filter((c) => c.getBoundingClientRect().height > 0).length }
  })
  check(`任务化：点击 summary 后展开且 ${TOOL_COUNT} 张卡可见`, opened.open && opened.visible === TOOL_COUNT,
    `open=${opened.open} visible=${opened.visible}`)

  /* 3) 任务卡内工序直达路由 */
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await wait(250)
  await page.evaluate(() => document.querySelector('.task-card[data-task="pack"] .task-step[data-step="/zip-compress"]').click())
  await wait(700)
  const routed = await page.evaluate(() => location.pathname)
  check('任务化：点击工序直达对应路由', routed === '/zip-compress', routed)

  /* 4) 命令面板 CTA 复用现有面板 */
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await wait(250)
  await page.evaluate(() => document.querySelector('[data-cta="cmd"]').click())
  await wait(300)
  const palette = await page.evaluate(() => {
    const p = document.querySelector('.palette')
    return { open: !!p, focused: !!(p && p.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') }
  })
  check('任务化：⌘K CTA 打开命令面板', palette.open, `open=${palette.open}`)
  check('任务化：命令面板输入框自动聚焦', palette.focused, `focused=${palette.focused}`)
  await page.keyboard.press('Escape')
  await wait(200)

  /* 5) 五语切换：任务卡标题随语言变化 */
  const cases = [
    { loc: 'zh-CN', name: '中文', expect: /打包与解压/, aria: /首页任务入口/ },
    { loc: 'en', name: 'English', expect: /Pack & Unpack/, aria: /Home task shortcuts/ },
    { loc: 'ja-JP', name: '日本語', expect: /梱包と展開/, aria: /ホームのタスク入口/ },
    { loc: 'ko-KR', name: '한국어', expect: /압축과 해제/, aria: /홈 작업 진입점/ },
    { loc: 'es-ES', name: 'Español', expect: /Empaquetar y extraer/, aria: /Atajos de tareas/ },
  ]
  for (const c of cases) {
    await page.evaluate((l) => localStorage.setItem('lf-locale', l), c.loc)
    await page.reload({ waitUntil: 'networkidle0' })
    await wait(350)
    const got = await page.evaluate(() => ({
      lang: document.documentElement.getAttribute('lang'),
      titles: Array.from(document.querySelectorAll('.taskboard .task-card h2')).map((e) => e.textContent.trim()),
      summary: (document.querySelector('details#all-tools summary') || {}).textContent.trim(),
      aria: (document.querySelector('.taskboard') || {}).getAttribute?.('aria-label') || '',
    }))
    check(`任务化：${c.name} 语言生效`, got.lang === c.loc, got.lang)
    check(`任务化：${c.name} 任务标题本地化`, c.expect.test(got.titles.join('|')), got.titles.join(' / '))
    check(`任务化：${c.name} 任务区 aria-label 本地化`, c.aria.test(got.aria), got.aria)
    check(`任务化：${c.name} 无 key 泄漏`, !RE_KEY_LEAK.test(got.titles.join('|') + ' ' + got.summary + ' ' + got.aria))
  }

  /* 6) 任务层纯前端，不得外发 */
  const externals = [...new Set(crossOrigin)]
  check('任务化：零跨域请求', externals.length === 0, externals.slice(0, 3).join(' '))

} finally {
  await browser.close()
}

console.log(`\n===== 首页任务化 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }
