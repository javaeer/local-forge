// 引擎端到端验证（真实浏览器，每次调用都用 fresh File，逐步容错）
import puppeteer from 'puppeteer-core'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-features=SharedArrayBuffer'],
})
const page = await browser.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message))

await page.goto(BASE_URL + '/', { waitUntil: 'networkidle0' })

const result = await page.evaluate(async () => {
  const mod = await import('/src/lib/archive.js')
  const enc = new TextEncoder()
  const mk = (name, text) => new File([enc.encode(text)], name)
  const fresh = (name, text) => new File([enc.encode(text)], name)
  const out = {}
  const T = async (key, fn) => { try { out[key] = await fn() } catch (e) { out[key] = 'ERR ' + e.message } }

  // 1) 创建可靠格式 + 解压回环（每次 fresh）
  for (const fmt of ['zip', 'tar', 'tar.gz']) {
    await T('create_' + fmt, async () => {
      const files = [fresh('hello.txt', 'hello world\n'), fresh('docs/a.md', '# a\n')]
      const blob = await mod.createArchive(files, { outputFileName: 'x.' + fmt })
      const entries = await mod.extract(new File([blob], 'rb.' + fmt))
      return { size: blob.size, entries: entries.map((e) => e.name) }
    })
  }
  // 2) 密码 ZIP + 回环解密（无密码/错密码必须失败，这是正确安全行为）
  await T('zip_pw', async () => {
    const files = [fresh('hello.txt', 'secret'), fresh('docs/b.md', 'more')]
    const pz = await mod.createZip(files, { password: 'test123' })
    const dec = await mod.extract(new File([pz], 'p.zip'), { password: 'test123' })
    let noPwOk = false, wrongPwOk = false
    try { await mod.extract(new File([pz], 'p2.zip')) } catch { noPwOk = true }
    try { await mod.extract(new File([pz], 'p3.zip'), { password: 'bad' }) } catch { wrongPwOk = true }
    return { size: pz.size, decrypt: dec.map((e) => e.name), noPwRejected: noPwOk, wrongPwRejected: wrongPwOk }
  })
  // 3) 转换 tar -> zip
  await T('convert', async () => {
    const files = [fresh('a.txt', 'x'), fresh('b/c.txt', 'y')]
    const tarBlob = await mod.createArchive(files, { outputFileName: 'y.tar' })
    const conv = await mod.convert(new File([tarBlob], 'y.tar'), 'zip')
    const es = await mod.extract(new File([conv], 'c.zip'))
    return es.map((e) => e.name)
  })
  // 4) 合并两个 zip
  await T('merge', async () => {
    const z1 = await mod.createZip([fresh('a.txt', 'A')])
    const z2 = await mod.createZip([fresh('b.txt', 'B')])
    const merged = await mod.merge([new File([z1], 'a.zip'), new File([z2], 'b.zip')], { outExt: 'zip' })
    const es = await mod.extract(new File([merged], 'm.zip'))
    return es.map((e) => e.name)
  })
  // 5) 不支持格式明确报错
  await T('unsupported_7z', async () => {
    try { await mod.createArchive([fresh('a.txt', 'x')], { outputFileName: 'x.7z' }); return 'NO ERROR' }
    catch (e) { return 'OK: ' + e.message.slice(0, 24) }
  })
  // 6) 修复：损坏 zip 尽力读取
  await T('repair', async () => {
    const good = await mod.createZip([fresh('keep.txt', 'data123')])
    const arr = new Uint8Array(await good.arrayBuffer()); arr[30] = 0
    const es = await mod.extract(new File([arr], 'bad.zip'))
    return es.map((e) => e.name)
  })
  // 7) 多格式解压能力：构造 rar/7z? 用 libarchive 读一个真实 tar 验证
  await T('extract_tar', async () => {
    const { writeTar } = await import('/src/lib/writers.js')
    const tar = await writeTar([fresh('nested/d.txt', 'deep')])
    const es = await mod.extract(new File([tar], 'z.tar'))
    return es.map((e) => e.name)
  })
  // 8) 分卷 ZIP 合并解压：单文件 zip 从内部切点拆分为 .z01 + .zip，拼接后应完整还原
  await T('split_zip', async () => {
    const big = 'x'.repeat(500)
    const zblob = await mod.createZip([fresh('big.txt', big)])
    const buf = new Uint8Array(await zblob.arrayBuffer())
    const cut = 60 // 落在文件数据区内（局部头约 37 字节之后），拼接后无损
    const p1 = new File([buf.slice(0, cut)], 'vol.z01')
    const p2 = new File([buf.slice(cut)], 'vol.zip')
    const isSet = mod.isSplitZipSet([p1, p2])
    const entries = await mod.extractSplitZip([p1, p2])
    const txt = await (await entries[0].getBlob()).text()
    return { isSet, count: entries.length, name: entries[0].name, ok: txt === big }
  })
  // 9) PDF 合并 / 拆分（pdf-lib）
  await T('pdf_merge_split', async () => {
    const td = await import('/src/lib/test-deps.js')
    const { PDFDocument } = td
    const mkPdf = async (label) => {
      const d = await PDFDocument.create()
      d.addPage([200, 200]).drawText(label)
      return new File([await d.save()], label + '.pdf')
    }
    const a = await mkPdf('A'), b = await mkPdf('B')
    const { mergePdf, splitPdf } = await import('/src/lib/pdf.js')
    const m = await mergePdf([a, b])
    const sp = await splitPdf(a)
    return { mergedName: m.name, mergedPages: m.count, splitParts: sp.length }
  })
  // 10) pdf.js 浏览器内加载与解析（预览能力的关键风险点）
  await T('pdf_preview', async () => {
    const td = await import('/src/lib/test-deps.js')
    td.pdfjs.GlobalWorkerOptions.workerSrc = td.workerUrl
    const { PDFDocument } = td
    const d = await PDFDocument.create()
    d.addPage([100, 100]).drawText('hi')
    const bytes = await d.save()
    const doc = await td.pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise
    return { numPages: doc.numPages }
  })
  return out
})

console.log(JSON.stringify(result, null, 2))
console.log('RUNTIME ERRORS:', errors.length ? errors : 'none')
await browser.close()
