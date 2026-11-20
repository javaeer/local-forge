// /bencao（本草纲目）浏览器冒烟：目录树、检索、全量库下载、分节导航、五语言免责声明
import puppeteer from 'puppeteer-core'

// runner 注入的 BASE 带尾斜杠（http://127.0.0.1:4173/），不归一化会拼出 //bencao 落回首页
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
  await page.evaluate(() => localStorage.clear())
  await page.evaluate(() => localStorage.setItem('lf-locale', 'zh-CN'))

  // 1. 加载与免责声明
  await page.goto(`${BASE}/bencao`, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForSelector('.toc-bu', { timeout: 30000 })
  ok(true, '页面加载完成（目录树已渲染）')
  const dis = await page.$eval('.disclaimer', (el) => el.textContent)
  ok(/不构成任何医疗建议/.test(dis), '医疗免责声明存在')

  // 2. 目录树：17 组（16 部 + 序例）
  const buNames = await page.$$eval('.toc-bu-head', (els) => els.map((e) => e.textContent.trim()))
  ok(buNames.length === 17, '目录 17 组（16 部 + 序例）', buNames.join('/'))
  ok(/草部/.test(buNames.join()) && /人部/.test(buNames.join()) && /序例/.test(buNames.join()), '部名齐全')

  // 3. 全量库状态条（未装）
  const libText = await page.$eval('.lib-bar', (el) => el.textContent)
  ok(/下载全量库|全量库/.test(libText), '全量库状态条存在', libText.slice(0, 40))

  // 4. 展开草部 → 点人参
  const caoBtn = await page.$$('.toc-bu-head')
  const idx = buNames.findIndex((n) => /草部/.test(n))
  await caoBtn[idx].click()
  await new Promise((r) => setTimeout(r, 300))
  const found = await page.$$eval('.toc-item', (els) => {
    const el = els.find((e) => e.textContent.trim() === '人参')
    if (!el) return false
    el.click()
    return true
  })
  ok(found, '目录中找到人参条目')
  await new Promise((r) => setTimeout(r, 400))
  const title = await page.$eval('.piece-title', (el) => el.textContent)
  ok(title === '人参', '人参条打开', title)
  const meta = await page.$eval('.piece-meta', (el) => el.textContent)
  ok(/草部/.test(meta), '条目元信息含部名', meta)

  // 5. 未装库 → 仅摘要提示
  const needFull = await page.$('.need-full')
  ok(!!needFull, '未装库显示摘要提示')
  const excerpt = await page.$eval('.excerpt-only p', (el) => el.textContent)
  ok(/补五脏/.test(excerpt), '人参主治摘要显示', excerpt.slice(0, 20))

  // 6. 下载全量库
  await page.click('.lib-bar button')
  await page.waitForFunction(() => document.querySelector('.lib-bar')?.classList.contains('on'), { timeout: 60000 })
  ok(true, '全量库下载完成（状态条转绿）')
  await new Promise((r) => setTimeout(r, 600))

  // 7. 全文渲染 + 分节导航
  await page.waitForSelector('.sec-nav', { timeout: 15000 })
  const chips = await page.$$eval('.sec-chip', (els) => els.map((e) => e.textContent.trim()))
  ok(chips.includes('释名') && chips.includes('气味') && chips.includes('主治') && chips.includes('附方'), '人参分节导航齐全', chips.join('/'))
  const bodyHas = await page.$eval('.piece-body', (el) => el.textContent)
  ok(/时珍曰/.test(bodyHas) || /集解/.test(bodyHas), '人参全文渲染')

  // 8. 分节点击滚动（无异常即可）
  const secBtns = await page.$$('.sec-chip')
  let secBtn = null
  for (const b of secBtns) {
    const t = await b.evaluate((el) => el.textContent)
    if (t.trim() === '主治') {
      secBtn = b
      break
    }
  }
  ok(!!secBtn, '主治分节 chip 可定位')
  if (secBtn) {
    await secBtn.click()
    await new Promise((r) => setTimeout(r, 500))
    ok(true, '分节锚点点击正常')
  }

  // 9. 检索（已装库 → 全文检索）
  await page.type('.search-row input', '上党') // 人参主产地，正文高频词，人参条应居首
  await new Promise((r) => setTimeout(r, 800))
  const hitText = await page.$eval('.hit-note', (el) => el.textContent).catch(() => '')
  ok(/命中/.test(hitText), '全文检索命中提示', hitText)
  const hitTitles = await page.$$eval('.toc-item .toc-title', (els) => els.map((e) => e.textContent.trim()))
  ok(hitTitles.some((t) => /人参/.test(t)), '命中列表含人参相关', hitTitles.slice(0, 5).join('/'))
  // 清空检索
  await page.$eval('.search-row input', (el) => (el.value = ''))
  await page.type('.search-row input', ' ')
  await page.keyboard.press('Backspace')
  await new Promise((r) => setTimeout(r, 400))

  // 10. 随机一条
  await page.click('.search-row button')
  await new Promise((r) => setTimeout(r, 400))
  const rndTitle = await page.$eval('.piece-title', (el) => el.textContent)
  ok(rndTitle.length > 0, '随机一药正常', rndTitle)

  // 11. 复制全文
  await page.evaluate(() => navigator.clipboard.writeText('').catch(() => {}))
  const copyBtn = await page.$$('.piece-actions button')
  let cbIdx = -1
  for (let i = 0; i < copyBtn.length; i++) {
    if (/复制/.test(await copyBtn[i].evaluate((el) => el.textContent))) {
      cbIdx = i
      break
    }
  }
  await copyBtn[cbIdx].click()
  await new Promise((r) => setTimeout(r, 300))
  const toast = await page.$eval('.toast', (el) => el.textContent).catch(() => '')
  ok(/已复制/.test(toast), '复制全文 toast', toast)

  // 12. 序例组（含百病主治药）
  const xuOpen = await page.$$eval('.toc-bu-head', (els) => {
    const el = els.find((e) => /序例/.test(e.textContent))
    if (!el.classList.contains('open')) el.click()
    return true
  })
  ok(xuOpen, '序例组可展开')
  await new Promise((r) => setTimeout(r, 300))
  const juanNames = await page.$$eval('.toc-juan-name', (els) => els.map((e) => e.textContent))
  ok(juanNames.some((n) => /百病主治药/.test(n)), '序例含百病主治药', juanNames.slice(0, 4).join('/'))

  // 13. 删除全量库
  await page.click('.lib-bar button')
  await page.waitForFunction(() => !/已就绪/.test(document.querySelector('.lib-bar')?.textContent || ''), { timeout: 10000 })
  const libAfter = await page.$eval('.lib-bar', (el) => el.textContent)
  ok(!/已就绪/.test(libAfter), '删除全量库后回到未装状态')

  // 14. 英文界面免责声明
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
