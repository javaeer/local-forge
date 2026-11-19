// /chants（中医药歌诀）浏览器冒烟：浏览、检索、背诵（挖空 / 首字 / 默写）、已会进度
import puppeteer from 'puppeteer-core'

// runner 注入的 BASE 带尾斜杠（http://127.0.0.1:4173/），不归一化会拼出 // chants 落回首页
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

try {
  // 0. 固定中文界面（headless Chromium 默认 locale 是 en，会走英文词条）
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.setItem('lf-locale', 'zh-CN'))

  // 1. 加载与免责声明
  await page.goto(`${BASE}/chants`, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForSelector('.piece-body p', { timeout: 30000 })
  ok(true, '页面加载完成（韵文区块已渲染）')
  const dis = await page.$eval('.disclaimer', (el) => el.textContent)
  ok(/不构成任何医疗建议/.test(dis), '医疗免责声明存在')

  // 2. 八书 tab
  const tabs = await page.$$eval('.book-tabs button', (els) => els.map((e) => e.textContent.trim()))
  ok(tabs.length === 8, '八本书 tab 齐全', tabs.join('/'))
  ok(/汤头歌诀/.test(tabs[0]) && /药性歌括四百味/.test(tabs[2]), '书名正确')

  // 3. 目录与正文
  const tocN = await page.$$eval('.toc-item', (els) => els.length)
  ok(tocN > 100, '目录条目数正常', `${tocN}`)
  const firstVerse = await page.$eval('.piece-body p', (el) => el.textContent)
  ok(/[\u4e00-\u9fff]/.test(firstVerse), '正文韵文渲染', firstVerse.slice(0, 20))

  // 4. 检索
  await page.type('.search-row input', '四君子')
  await new Promise((r) => setTimeout(r, 400))
  const hitText = await page.$eval('.toc-hit', (el) => el.textContent)
  ok(/命中/.test(hitText), '检索命中提示', hitText)
  const markHtml = await page.$eval('.toc-title', (el) => el.innerHTML)
  ok(/<mark>/.test(markHtml), '命中词高亮', markHtml.slice(0, 60))
  await page.$eval('.search-row input', (el) => (el.value = ''))
  await page.type('.search-row input', ' ')
  await page.keyboard.press('Backspace')
  await new Promise((r) => setTimeout(r, 400))

  // 5. 切书：药性歌括四百味 → 人参条
  await page.$$eval('.book-tabs button', (els) => els[2].click())
  await new Promise((r) => setTimeout(r, 300))
  const sbToc = await page.$$eval('.toc-item', (els) => els.map((e) => e.textContent.trim()))
  ok(sbToc.includes('人参'), '药性歌括含「人参」条')
  // 点击人参
  const found = await page.$$eval('.toc-item', (els) => {
    const el = els.find((e) => e.textContent.trim() === '人参')
    if (!el) return false
    el.click()
    return true
  })
  if (!found) throw new Error('目录中未找到人参条目')
  await new Promise((r) => setTimeout(r, 300))
  const title = await page.$eval('.piece-title', (el) => el.textContent)
  ok(title === '人参', '打开人参条目', title)

  // 6. 背诵：从本条开始（浏览 tab 的「从本条开始背」按钮）
  await page.$$eval('.search-row button', (els) => els.find((e) => /从本条开始背/.test(e.textContent)).click())
  await new Promise((r) => setTimeout(r, 500))
  const reciteTitle = await page.$eval('.recite .piece-title', (el) => el.textContent).catch(() => '')
  ok(reciteTitle === '人参', '背诵页载入人参条', reciteTitle)

  // 7. 挖空模式：存在遮盖块，点击可揭开
  let maskedN = await page.$$eval('.masked', (els) => els.length).catch(() => 0)
  ok(maskedN > 0, '挖空模式存在遮盖字符', `${maskedN}`)
  await page.click('.masked')
  const revealedN = await page.$$eval('.revealed', (els) => els.length).catch(() => 0)
  ok(revealedN >= 1, '点击揭开一个字符')

  // 8. 首字提示模式
  await page.$$eval('.seg button', (els) => els.find((e) => /首字/.test(e.textContent)).click())
  await new Promise((r) => setTimeout(r, 200))
  const firstTwo = await page.$eval('.mask-line', (el) => el.textContent.trim().slice(0, 2))
  ok(!/●/.test(firstTwo[0]) && /●/.test(firstTwo[1]), '首字模式仅句首可见', firstTwo)
  const bodyHasMask = await page.$$eval('.masked', (els) => els.length > 0)
  ok(bodyHasMask, '首字模式仍遮其余字')

  // 9. 默写模式：比对
  await page.$$eval('.seg button', (els) => els.find((e) => /默写/.test(e.textContent)).click())
  await new Promise((r) => setTimeout(r, 200))
  const answer = await page.$eval('.piece-head', () => '')
  // 从页面拿不到答案（被遮盖设计），直接写入错误内容验证比对输出
  await page.type('.dict', '完全不对的内容')
  await page.$$eval('.piece-actions button', (els) => els.find((e) => /比对/.test(e.textContent)).click())
  await new Promise((r) => setTimeout(r, 300))
  const score = await page.$eval('.dict-score', (el) => el.textContent).catch(() => '')
  ok(/得分/.test(score), '默写比对出分', score)
  const badN = await page.$$eval('.dict-marks .bad', (els) => els.length)
  ok(badN > 0, '错字标红', `${badN}`)

  // 10. 已会进度
  await page.$$eval('.piece-actions button', (els) => els.find((e) => /已会|标记/.test(e.textContent)).click())
  await new Promise((r) => setTimeout(r, 200))
  const prog = await page.$eval('.prog', (el) => el.textContent)
  ok(/1 \/ \d+ 条已会/.test(prog), '已会进度更新', prog)

  // 11. 多语言：切英文后导航词条生效
  await page.evaluate(() => localStorage.setItem('lf-locale', 'en'))
  await page.goto(`${BASE}/chants`, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForSelector('.piece-body p', { timeout: 30000 })
  const h1 = await page.$eval('.page-title', (el) => el.textContent)
  ok(h1.includes('TCM'), '英文界面标题本地化', h1)
  const disEn = await page.$eval('.disclaimer', (el) => el.textContent)
  ok(/not medical advice/i.test(disEn), '英文免责声明', disEn.slice(0, 60))
} catch (e) {
  fail++
  console.log('  ✗ 异常：' + e.message)
  try {
    console.log('  [url]', page.url())
    const body = await page.$eval('body', (el) => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 300))
    console.log('  [body]', body)
    const html = await page.$eval('h1', (el) => el.textContent).catch(() => '(no h1)')
    console.log('  [h1]', html)
  } catch (e2) {
    console.log('  [dump fail]', e2.message)
  }
} finally {
  await browser.close()
}
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
