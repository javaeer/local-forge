// /tcmbooks（方书与医经）浏览器冒烟：九书 tab、卷篇目录、全量库下载、Worker 全文检索、免责声明
import puppeteer from 'puppeteer-core'

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
await page.setViewport({ width: 1280, height: 900 })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 200)) })
page.on('requestfailed', (r) => console.log('  [reqfail]', r.url().slice(-60), r.failure()?.errorText))
page.on('response', async (r) => {
  if (/\.gz(\?|$)/.test(r.url()) && (r.status() !== 200 || /text\/html/.test(r.headers()['content-type'] || ''))) {
    console.log('  [gz-bad]', r.status(), r.headers()['content-type'], r.url().slice(-60))
  }
})

try {
  // 0. 固定中文
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.evaluate(() => localStorage.setItem('lf-locale', 'zh-CN'))

  // 1. 加载与免责声明
  await page.goto(`${BASE}/tcmbooks`, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForSelector('.book-tabs button', { timeout: 30000 })
  ok(true, '页面加载完成（九书 tab 已渲染）')
  const dis = await page.$eval('.disclaimer', (el) => el.textContent)
  ok(/不构成任何医疗建议/.test(dis), '医疗免责声明存在')

  // 2. 九书 tab
  const tabs = await page.$$eval('.book-tabs button', (els) => els.map((e) => e.textContent.trim()))
  ok(tabs.length === 9, '九本书 tab 齐全', tabs.join('/'))
  ok(/备急千金要方/.test(tabs[0]) && /本草备要/.test(tabs[8]), '首尾书名正确')

  // 3. 目录树（卷组 + 篇章）
  const groupsN = await page.$$eval('.toc-group', (els) => els.length)
  ok(groupsN > 10, '千金要方卷组渲染', `${groupsN}`)
  const tocN = await page.$$eval('.toc-item', (els) => els.length)
  ok(tocN > 10, '篇章条目渲染', `${tocN}`)
  const title = await page.$eval('.piece-title', (el) => el.textContent)
  ok(title === '《备急千金要方》序', '默认打开首篇', title)
  const body = await page.$eval('.piece-body', (el) => el.textContent)
  ok(/清浊剖判/.test(body), '正文渲染正确', body.slice(0, 20))

  // 4. 未装库状态条 + 标题检索
  const libText = await page.$eval('.lib-bar', (el) => el.textContent)
  ok(/下载全量库/.test(libText), '未装库状态条')
  await page.type('.search-row input', '大医精诚')
  await new Promise((r) => setTimeout(r, 700))
  const hits = await page.$$eval('.toc-item .toc-title', (els) => els.map((e) => e.textContent.trim()))
  ok(hits.some((t) => /大医精诚/.test(t)), '未装库篇名检索命中', hits.slice(0, 3).join('/'))
  // 清空检索
  await page.$eval('.search-row input', (el) => (el.value = ''))
  await page.type('.search-row input', ' ')
  await page.keyboard.press('Backspace')
  await new Promise((r) => setTimeout(r, 400))

  // 5. 下载全量库（17 分片）
  await page.click('.lib-bar button')
  await page.waitForFunction(() => document.querySelector('.lib-bar')?.classList.contains('on'), { timeout: 120000 })
  ok(true, '全量库下载完成（状态条转绿）')
  await new Promise((r) => setTimeout(r, 1000))

  // 6. 切书：伤寒论 + Worker 全文检索
  const tabs2 = await page.$$('.book-tabs button')
  await tabs2[5].click() // 伤寒论
  await new Promise((r) => setTimeout(r, 500))
  const shTitle = await page.$eval('.piece-title', (el) => el.textContent)
  ok(/太阳/.test(shTitle), '伤寒论首篇打开', shTitle)
  const shBody = await page.$eval('.piece-body', (el) => el.textContent)
  ok(/脉浮/.test(shBody), '伤寒论正文正确', shBody.slice(0, 24))

  await page.type('.search-row input', '脉浮 恶寒')
  await page.waitForFunction(() => {
    const n = document.querySelector('.hit-note')?.textContent || ''
    return /\d/.test(n) && !/…/.test(n)
  }, { timeout: 20000 })
  const hitNote = await page.$eval('.hit-note', (el) => el.textContent)
  ok(/命中/.test(hitNote), 'Worker 全文检索命中提示', hitNote)
  const hitTitles = await page.$$eval('.toc-item .toc-title', (els) => els.map((e) => e.textContent.trim()))
  ok(hitTitles.some((t) => /太阳/.test(t)), '全文检索命中太阳病篇', hitTitles.slice(0, 4).join('/'))
  const snip = await page.$$eval('.toc-item .toc-ex', (els) => els.map((e) => e.textContent.trim()))
  ok(snip.some((s) => /脉浮|恶寒/.test(s)), '检索结果带命中摘要', snip.slice(0, 2).join('/'))

  // 7. 随机 + 复制
  await page.click('.search-row button')
  await new Promise((r) => setTimeout(r, 400))
  const rnd = await page.$eval('.piece-title', (el) => el.textContent)
  ok(rnd.length > 0, '随机一篇正常', rnd)
  const cbtns = await page.$$('.piece-actions button')
  await cbtns[0].click()
  await new Promise((r) => setTimeout(r, 300))
  const toast = await page.$eval('.toast', (el) => el.textContent).catch(() => '')
  ok(/已复制/.test(toast), '复制全文 toast', toast)

  // 8. 删除全量库
  await page.click('.lib-bar button')
  await new Promise((r) => setTimeout(r, 600))
  const libAfter = await page.$eval('.lib-bar', (el) => el.textContent)
  ok(!/已就绪/.test(libAfter), '删除后回到未装状态')

  // 9. 英文免责声明
  await page.evaluate(() => localStorage.setItem('lf-locale', 'en'))
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.disclaimer', { timeout: 20000 })
  const disEn = await page.$eval('.disclaimer', (el) => el.textContent)
  ok(/not medical advice/i.test(disEn), '英文免责声明', disEn.slice(0, 60))
} catch (e) {
  fail++
  console.log('  ✗ 异常：' + e.message)
  try {
    console.log('  [url]', page.url())
    const body = await page.$eval('body', (el) => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 300))
    console.log('  [body]', body)
  } catch (e2) {
    console.log('  [dump fail]', e2.message)
  }
} finally {
  await browser.close()
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}
