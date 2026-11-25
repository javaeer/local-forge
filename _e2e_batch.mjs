// B-1 批处理队列 e2e：
//  - /batch 路由可达，页面渲染操作/预设选择器
//  - 注入多张图片，选择「图片压缩」+ 预设，跑完整队列，验证逐项完成 + 结果可打包
//  - 混合文件时自动筛出可处理项
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
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('lf-locale', 'zh-CN') } catch {} })
  await page.setViewport({ width: 1280, height: 1000 })

  await page.goto(BASE + 'batch', { waitUntil: 'networkidle0' })
  await page.waitForSelector('.dropzone input[type=file]', { timeout: 15000 })
  await wait(400)

  const ui = await page.evaluate(() => ({
    title: (document.querySelector('.page-title') || {}).textContent || '',
    selects: document.querySelectorAll('.panel select').length,
  }))
  check('B1：/batch 路由可达', /批处理/.test(ui.title), ui.title)

  // 注入 3 张图片
  const injected = await page.evaluate(async () => {
    function makePng(color) {
      const c = document.createElement('canvas'); c.width = 40; c.height = 40
      const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 40, 40)
      return new Promise((res) => c.toBlob((b) => res(b), 'image/png'))
    }
    const files = []
    for (const [i, col] of ['#38bdf8', '#a78bfa', '#34d399'].entries()) {
      const blob = await makePng(col)
      files.push(new File([blob], `pic${i + 1}.png`, { type: 'image/png' }))
    }
    const input = document.querySelector('.dropzone input[type=file]')
    if (!input) return 'no-input'
    const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok'
  })
  check('B1：注入 3 张图片', injected === 'ok', injected)
  await wait(500)

  const listed = await page.evaluate(() => ({
    items: document.querySelectorAll('.qitem').length,
    statusText: (document.querySelector('.status') || {}).textContent.replace(/\s+/g, ' ').trim(),
  }))
  check('B1：队列列出 3 项', listed.items === 3, `items=${listed.items}`)
  check('B1：状态显示可处理数量', /可处理/.test(listed.statusText), listed.statusText)

  // 选预设「网页优化」
  await page.evaluate(() => {
    const sel = Array.from(document.querySelectorAll('.panel select')).find((s) =>
      Array.from(s.options).some((o) => /预设/.test(o.textContent)))
    if (sel) {
      const opt = Array.from(sel.options).find((o) => /网页优化/.test(o.textContent))
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })) }
    }
  })
  await wait(300)

  // 开始批处理
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.btn')).find((b) => /开始批处理/.test(b.textContent))
    if (btn) btn.click()
  })
  // 等待队列跑完（3 张图，压缩很快）
  await page.waitForFunction(() => {
    const items = Array.from(document.querySelectorAll('.qitem'))
    return items.length > 0 && items.every((i) => /done|error/.test(i.className))
  }, { timeout: 30000 })
  await wait(400)

  const done = await page.evaluate(() => ({
    done: document.querySelectorAll('.qitem.done').length,
    err: document.querySelectorAll('.qitem.error').length,
    hasZip: !!Array.from(document.querySelectorAll('.btn')).find((b) => /打包全部/.test(b.textContent)),
  }))
  check('B1：3 项全部处理完成', done.done === 3, `done=${done.done} err=${done.err}`)
  check('B1：出现「打包全部为 ZIP」按钮', done.hasZip)

  /* 混合文件自动筛选：往队列补一个 .txt（不支持），应被跳过 */
  await page.goto(BASE + 'batch', { waitUntil: 'networkidle0' })
  await page.waitForSelector('.dropzone input[type=file]', { timeout: 15000 })
  const mixed = await page.evaluate(async () => {
    const png = await new Promise((res) => {
      const c = document.createElement('canvas'); c.width = 20; c.height = 20
      c.getContext('2d').fillRect(0, 0, 20, 20); c.toBlob((b) => res(b), 'image/png')
    })
    const files = [
      new File([png], 'ok.png', { type: 'image/png' }),
      new File([new Blob(['hello'])], 'note.txt', { type: 'text/plain' }),
    ]
    const input = document.querySelector('.dropzone input[type=file]')
    const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok'
  })
  check('B1：注入混合文件', mixed === 'ok')
  await wait(400)
  const filtered = await page.evaluate(() => {
    const s = (document.querySelector('.status') || {}).textContent.replace(/\s+/g, ' ').trim()
    return { text: s, skipped: /跳过/.test(s) }
  })
  check('B1：自动筛出不支持的文件', filtered.skipped, filtered.text)

} finally {
  await browser.close()
}

console.log(`\n===== B-1 批处理队列 e2e：${results.length - failed}/${results.length} 通过 =====`)
if (failed) { console.log(`失败 ${failed} 项`); process.exit(1) }