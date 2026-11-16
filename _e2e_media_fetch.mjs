#!/usr/bin/env node
// e2e：媒体获取（/media-fetch）—— 页面可达 / 直链解析 / 按钮门槛 / 桥接持久化 / 首页卡片 / 零外发请求。
//
// 设计原则：全程不触发真实下载。
//   · 空输入时「获取」按钮必须 disabled（拦截发生在点击之前）；
//   · 桥接模式只验证配置与 localStorage 持久化，不发请求；
//   · 合并需要 >= 2 个已获取文件，初始必为 disabled。
// 这样套件可以在 CI 里离线稳定运行，不会因为外网抖动而假红。
//
// 运行方式（tests/run.mjs 统一拉起 preview）：
//   BASE=http://localhost:4173 node _e2e_media_fetch.mjs
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || process.env.BASE_URL || 'http://localhost:4173'
const CHROME = process.env.CHROME_PATH || process.env.CHROMIUM_PATH || '/usr/bin/chromium'

let failed = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failed++
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })

const errors = []
const offsite = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('request', (r) => {
  const u = r.url()
  if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) offsite.push(u)
})

// 1) 页面可达且标题正确
await page.goto(BASE + '/media-fetch', { waitUntil: 'networkidle2', timeout: 90000 })
const title = await page.$eval('h1.page-title', (el) => el.textContent.trim())
ok(title === '媒体获取', '路由 /media-fetch 可达且标题正确', title)

// 2) 初始门槛：无输入时「获取」disabled，「合并」disabled
const btnState = async () => page.$$eval('button.btn', (els) => els.map((e) => ({ t: e.textContent.replace(/\s+/g, '').trim(), d: e.disabled })))
{
  const st = await btnState()
  const fetchBtn = st.find((x) => x.t.includes('获取') && !x.t.includes('已获取'))
  const mergeBtn = st.find((x) => x.t.includes('合并'))
  ok(!!fetchBtn && fetchBtn.d === true, '空输入时「获取」按钮被禁用')
  ok(!!mergeBtn && mergeBtn.d === true, '无已获取文件时「合并」按钮被禁用')
}

// 3) 直链解析：3 行（含空行与 CRLF）应解析出 3 条
await page.click('textarea')
await page.type('textarea', 'https://a.test/1.ts\nhttps://a.test/2.ts\n\nhttps://a.test/3.ts')
await new Promise((r) => setTimeout(r, 120))
{
  const hint = await page.$eval('.hint', (el) => el.textContent.replace(/\s+/g, ' ').trim())
  ok(/共解析到\s*3\s*个链接/.test(hint), '多行直链解析为 3 条（空行被忽略）', hint)
  const st = await btnState()
  const fetchBtn = st.find((x) => x.t.includes('获取') && !x.t.includes('已获取'))
  ok(fetchBtn && fetchBtn.d === false, '有输入后「获取」按钮解禁')
}

// 4) 桥接模式：勾选后出现地址输入框，写入后落到 localStorage
{
  const before = await page.$('input[placeholder*="your-proxy"]')
  ok(before === null, '桥接输入框默认隐藏（直链模式）')

  await page.click('input[type=checkbox]')
  await page.waitForSelector('input[placeholder*="your-proxy"]', { timeout: 5000 })
  ok(true, '勾选「桥接模式」后出现地址输入框')

  const BRIDGE = 'https://my.proxy.test/{url}'
  await page.type('input[placeholder*="your-proxy"]', BRIDGE)
  await new Promise((r) => setTimeout(r, 150))
  const stored = await page.evaluate(() => localStorage.getItem('lf-md-bridge'))
  ok(stored === BRIDGE, '桥接地址写入 localStorage（lf-md-bridge）', String(stored))
}

// 5) 刷新后持久化：重新勾选，输入框应回填上次地址
{
  await page.reload({ waitUntil: 'networkidle2' })
  await page.click('input[type=checkbox]')
  await page.waitForSelector('input[placeholder*="your-proxy"]', { timeout: 5000 })
  const val = await page.$eval('input[placeholder*="your-proxy"]', (el) => el.value)
  ok(val === 'https://my.proxy.test/{url}', '刷新后桥接地址自动回填', val)
}

// 6) 首页卡片可达
await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
{
  const present = await page.evaluate(() =>
    [...document.querySelectorAll('.tool-card')].some((a) => a.getAttribute('href') === '/media-fetch'))
  ok(present, '首页含「媒体获取」卡片')
}

// 7) 控制台零错误 + 零外发请求（项目统一标准）
ok(errors.length === 0, '控制台零错误', errors.slice(0, 3).join(' | '))
ok(offsite.length === 0, '零外发请求', offsite.slice(0, 3).join(' | '))

await page.screenshot({ path: '/tmp/media-fetch-e2e.png' })
await browser.close()
process.exit(failed ? 1 : 0)
