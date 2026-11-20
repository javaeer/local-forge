// /classics 全量库下载回归：
// 1) 静态托管缺数据时（SPA 回退 HTML）必须给可执行提示，不能漏 Unexpected token '<'；
// 2) 数据齐全时下载 → IndexedDB → Worker 检索 → 删除仍正常。
import puppeteer from 'puppeteer-core'

// runner 注入的 BASE 带尾斜杠，不归一化会拼出 //classics 落回首页
const BASE = (process.env.BASE || 'http://localhost:4173').replace(/\/+$/, '')
let pass = 0
let fail = 0
const ok = (cond, name, detail = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
// SW 会 stale-while-revalidate 缓存 .json.gz，绕过它才能稳定注入「缺数据」场景
await page.setBypassServiceWorker(true)
await page.setViewport({ width: 1280, height: 900 })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 200)) })

async function clearDb() {
  await page.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.deleteDatabase('lf-poems')
    r.onsuccess = r.onerror = r.onblocked = () => resolve()
  }))
}

async function openFullTab() {
  await page.goto(`${BASE}/classics`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('.tabs button', { timeout: 30000 })
  const tabs = await page.$$('.tabs button')
  await tabs[tabs.length - 1].click() // 最后一个是「全量库」
}

try {
  // 0. 中文界面 + 干净 IndexedDB
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('lf-locale', 'zh-CN')
  })
  await clearDb()

  // 1. 模拟 Cloudflare Pages 的 /* /index.html 200：索引请求拿回 HTML
  const onRequest = (req) => {
    if (req.url().includes('/classics/full-index.json.gz')) {
      req.respond({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>LocalForge</title></head><body>首页</body></html>',
      })
    } else {
      req.continue()
    }
  }
  await page.setRequestInterception(true)
  page.on('request', onRequest)

  await openFullTab()
  await page.waitForSelector('.full-off .btn', { timeout: 30000 })
  ok(true, '全量库未安装状态可进入')
  await page.click('.full-off .btn')
  await page.waitForSelector('.full-off .msg.err', { timeout: 20000 })
  const errText = await page.$eval('.full-off .msg.err', (el) => el.textContent)
  ok(/未随本次构建发布/.test(errText), 'HTML 回退被识别为“数据未发布”', errText.slice(0, 80))
  ok(/npm run poems-full:fetch/.test(errText), '提示里带生成命令', errText.slice(0, 100))
  ok(!/Unexpected token/.test(errText), '不再暴露原始 JSON 语法错', errText.slice(0, 80))

  // 2. 恢复正常请求，验证真实数据链路没有回归
  page.off('request', onRequest)
  await page.setRequestInterception(false)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await clearDb()
  await openFullTab()
  await page.waitForSelector('.full-off .btn', { timeout: 30000 })
  await page.click('.full-off .btn')
  await page.waitForFunction(() => !document.querySelector('.full-off'), { timeout: 240000 })
  ok(true, '全量库下载完成（46 分片落 IndexedDB）')

  await page.type('.search-row input.input', '明月')
  await page.click('.search-row button.btn')
  await page.waitForFunction(
    () => !!document.querySelector('.full-hit') || !!document.querySelector('.full-empty'),
    { timeout: 60000 },
  )
  const hits = await page.$$eval('.full-hit', (els) => els.length)
  ok(hits > 0, 'Worker 全文检索命中', `hits=${hits}`)

  const hit = await page.$('.full-hit')
  if (hit) {
    await hit.click()
    await page.waitForSelector('.full-piece .piece-title', { timeout: 20000 })
    const title = await page.$eval('.full-piece .piece-title', (el) => el.textContent)
    ok(!!title, '命中篇目可读正文', title)
  }

  await page.click('.btn.ghost.danger')
  await page.waitForSelector('.full-off', { timeout: 20000 })
  ok(true, '全量库可删除并回到未装状态')
} catch (e) {
  fail++
  console.log('  ✗ 脚本异常：', e.message)
} finally {
  await browser.close()
  console.log(`全量库下载回归：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}
