#!/usr/bin/env node
// e2e：离线词典 —— 词库装载 / 五种检索 / 首页卡片 / 控制台零错误。
//
// 运行方式（tests/run.mjs 统一拉起 preview）：
//   BASE=http://localhost:4173 node _e2e_dictionary.mjs
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/dictionary', { waitUntil: 'networkidle2', timeout: 90000 })

// 1) 词库装载完成（状态栏出现「条」且不再处于装载态）
await page.waitForFunction(() => {
  const el = document.querySelector('.status')
  return el && /条/.test(el.textContent) && !/正在装载/.test(el.textContent)
}, { timeout: 120000 })
const status = await page.$eval('.status', (el) => el.textContent.replace(/\s+/g, ' ').trim())
const entries = Number((/([\d,]+) 条/.exec(status) || [])[1]?.replace(/,/g, '') || 0)
ok(entries >= 100000, '内置词库装载完成', status)
ok(/后台线程/.test(status), '索引构建在后台线程（Worker 生效）', status)

// 2) 五种检索
async function lookup(q, mode) {
  await page.evaluate(() => { const el = document.querySelector('.search-input'); el.value = '' })
  await page.click('.search-input')
  await page.type('.search-input', q)
  if (mode) await page.select('select', mode)
  await page.waitForFunction((qq) => {
    const bar = document.querySelector('.result-bar')
    return bar && bar.textContent.includes(qq)
  }, { timeout: 20000 }, q)
  await new Promise((r) => setTimeout(r, 350))
  const words = await page.$$eval('.dict-item .di-word', (els) => els.map((e) => e.textContent))
  const total = Number((await page.$eval('.result-bar b', (el) => el.textContent)).replace(/,/g, ''))
  return { total, words }
}

{
  const r = await lookup('绿色')
  ok(r.total > 0 && r.words[0] === '绿色', '精确检索「绿色」', `total=${r.total} top=${r.words[0]}`)
  const py = await page.$eval('.dict-item .di-py', (el) => el.textContent)
  ok(py === 'lǜ sè', '数字声调已转为带调拼音', py)
}
{
  const r = await lookup('lvse')
  ok(r.words.includes('绿色'), '无调拼音 lvse → 绿色', `total=${r.total}`)
}
{
  const r = await lookup('nh')
  ok(r.words[0] === '你好', '首字母 nh → 你好', `total=${r.total}`)
}
{
  const r = await lookup('bicycle', 'gloss')
  ok(r.words.includes('自行车'), '英文释义 bicycle → 自行车', `total=${r.total}`)
  const ipa = await page.$eval('.ipa-card .ipa-val', (el) => el.textContent).catch(() => '')
  ok(/^\/.+\/$/.test(ipa), '英文单词附带 IPA 音标卡（美式）', ipa)
  const hasPlay = await page.$('.ipa-card .ipa-play') !== null
  ok(hasPlay, '音标卡带朗读按钮')
}
{
  const r = await lookup('绿仓', 'fuzzy')
  ok(r.total > 0 && r.words[0]?.startsWith('绿'), '模糊纠错「绿仓」', `total=${r.total} top=${r.words[0]}`)
}

// 3) 词条展开 + 复制按钮存在
{
  await page.click('.dict-item .di-head')
  const hasCopy = await page.$('.di-more .btn') !== null
  ok(hasCopy, '词条可展开并含复制操作')
}

// 4) 首页卡片可达
await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
const cardHref = await page.evaluate(() => {
  const a = [...document.querySelectorAll('.tool-card')].find((x) => x.getAttribute('href') === '/dictionary')
  return a ? 'present' : ''
})
ok(cardHref === 'present', '首页含「离线词典」卡片')

// 5) 控制台零运行时错误（与项目其他 e2e 同一标准）
ok(errors.length === 0, '控制台零错误', errors.slice(0, 3).join(' | '))

await page.screenshot({ path: '/tmp/dict-e2e.png' })
await browser.close()
process.exit(failed ? 1 : 0)
