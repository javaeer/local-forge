// 缺陷修复回归测试：覆盖 D-1 / D-2 / D-4 / D-5 / D-7 / D-8。
// 这些缺陷在修复前全部"测试全绿"却真实存在，本文件用于防止回归。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hexDecode, jsonFormat, jsonMinify, collectRegexMatches } from '../../src/lib/text.js'
import { isSplitZipSet } from '../../src/lib/archive.js'
import { markdownToHtml, safeHref } from '../../src/lib/docconvert.js'
import { writeTar } from '../../src/lib/writers.js'
import SVGTool from '../../src/lib/svgtool.js'

/* -------- D-8：hexDecode 非法字符必须报错，而非静默返回空 -------- */
test('D-8 hexDecode 遇到非法字符抛错', () => {
  assert.throws(() => hexDecode('zz'), /非十六进制/)
  assert.throws(() => hexDecode('4g'), /非十六进制/)
})

test('D-8 hexDecode 合法输入与空白分隔仍可用', () => {
  assert.equal(hexDecode('4142'), 'AB')
  assert.equal(hexDecode('41 42'), 'AB')
  assert.equal(hexDecode('41\n42'), 'AB')
})

/* -------- D-5：JSON 格式化不得改写大整数 / 1e400 -------- */
test('D-5 jsonFormat 保留大整数与指数字面量', () => {
  const out = jsonFormat('{"id":12345678901234567890,"x":1e400}', 2)
  assert.match(out, /12345678901234567890/)
  assert.doesNotMatch(out, /12345678901234567000/)
  assert.match(out, /1e400/)
  assert.doesNotMatch(out, /"x":\s*null/)
})

test('D-5 jsonMinify 保留大整数', () => {
  assert.equal(jsonMinify(jsonFormat('{"id":12345678901234567890}', 2)), '{"id":12345678901234567890}')
})

test('D-5 常规 JSON 往返仍等价', () => {
  const raw = '{"a":1,"b":[2,3],"c":{"d":"中文"},"e":true,"f":null}'
  assert.equal(jsonMinify(jsonFormat(raw, 2)), raw)
})

/* -------- D-2：分卷识别必须同主名 + 连续编号 -------- */
test('D-2 两个无关 ZIP 不被误判为分卷', () => {
  assert.equal(isSplitZipSet([{ name: 'a.zip' }, { name: 'b.zip' }]), false)
  assert.equal(isSplitZipSet([{ name: 'x.z01' }, { name: 'y.zip' }]), false)
})

test('D-2 合法分卷集被识别（形态 A / 形态 B）', () => {
  assert.equal(isSplitZipSet([{ name: 'vol.z01' }, { name: 'vol.zip' }]), true)
  assert.equal(isSplitZipSet([{ name: 'vol.z01' }, { name: 'vol.z02' }, { name: 'vol.zip' }]), true)
  assert.equal(isSplitZipSet([{ name: 'a.zip.001' }, { name: 'a.zip.002' }]), true)
})

test('D-2 编号缺口 / 缺末卷 / 不足两卷 不算分卷', () => {
  assert.equal(isSplitZipSet([{ name: 'vol.z01' }, { name: 'vol.z03' }, { name: 'vol.zip' }]), false)
  assert.equal(isSplitZipSet([{ name: 'vol.z01' }, { name: 'vol.z02' }]), false)
  assert.equal(isSplitZipSet([{ name: 'vol.zip' }]), false)
})

/* -------- D-7：导出 HTML 的链接协议白名单 -------- */
test('D-7 safeHref 拦截危险协议、放行安全协议', () => {
  assert.equal(safeHref('javascript:alert(1)'), '#')
  assert.equal(safeHref('data:text/html,<script>'), '#')
  assert.equal(safeHref('vbscript:x'), '#')
  assert.equal(safeHref('https://a.cn'), 'https://a.cn')
  assert.equal(safeHref('mailto:a@b.c'), 'mailto:a@b.c')
  assert.equal(safeHref('#anchor'), '#anchor')
  assert.equal(safeHref('/path'), '/path')
  assert.equal(safeHref('a/b.html'), 'a/b.html')
})

test('D-7 markdownToHtml 不输出 javascript: 链接', () => {
  const html = markdownToHtml('[x](javascript:alert(1)) [ok](https://a.cn)')
  assert.doesNotMatch(html, /href="javascript:/i)
  assert.match(html, /href="https:\/\/a\.cn"/)
})

/* -------- D-1：sanitizeSVG 清除无引号事件属性（Node 正则兜底路径） -------- */
test('D-1 sanitizeSVG 清除无引号 onerror', () => {
  const out = SVGTool.sanitizeSVG('<svg><img src=x onerror=window.x=1></svg>')
  assert.doesNotMatch(out, /onerror/i)
})

test('D-1 sanitizeSVG 清除带引号 onload / script / javascript: 协议', () => {
  assert.doesNotMatch(SVGTool.sanitizeSVG('<svg onload="x()"><rect/></svg>'), /onload/i)
  assert.doesNotMatch(SVGTool.sanitizeSVG('<svg><script>bad()</script><rect/></svg>'), /<script/i)
  assert.doesNotMatch(SVGTool.sanitizeSVG('<svg><a href="javascript:x()">a</a></svg>'), /javascript:/i)
})

test('D-1 sanitizeSVG 清除 <svg/onload> 无引号畸形写法', () => {
  const out = SVGTool.sanitizeSVG('<svg/onload=window.x=1>')
  assert.doesNotMatch(out, /onload/i)
})

/* -------- D-4：TAR 写入不得截断长名 / 破坏中文 -------- */
test('D-4 writeTar 长路径与中文名往返完整', async () => {
  const enc = new TextEncoder()
  const longDir = 'dir/' + 'x'.repeat(120) + '/'
  const files = [
    new File([enc.encode('A')], longDir + 'a-111.txt'),
    new File([enc.encode('B')], longDir + 'a-222.txt'),
    new File([enc.encode('C')], '中文目录/' + '测'.repeat(40) + '/最终.txt'),
  ]
  const blob = await writeTar(files)
  const buf = new Uint8Array(await blob.arrayBuffer())
  const dec = new TextDecoder()
  // 扫描所有 512 字节头，收集 name/prefix 与 PAX path
  const names = []
  for (let off = 0; off + 512 <= buf.length; off += 512) {
    const name = dec.decode(buf.slice(off, off + 100)).replace(/\0.*$/, '')
    const prefix = dec.decode(buf.slice(off + 345, off + 500)).replace(/\0.*$/, '')
    if (!name) continue
    if (prefix) names.push(prefix + '/' + name)
    else names.push(name)
  }
  // 两个仅尾名不同的长文件不应变成同名
  assert.notEqual(names[0], names[1])
  assert.ok(names.some((n) => n.endsWith('a-111.txt')))
  assert.ok(names.some((n) => n.endsWith('a-222.txt')))
  // 中文路径完整（未在字节边界损坏）
  assert.ok(names.some((n) => n.includes('最终.txt') && n.startsWith('中文目录/测')))
})

/* -------- D-6：匹配核心逻辑可复用于 Worker -------- */
test('D-6 collectRegexMatches 正常匹配与非法正则', () => {
  const r = collectRegexMatches('\\d+', 'g', 'a1b22c333')
  assert.equal(r.count, 3)
  assert.throws(() => collectRegexMatches('(', '', 'x'), /不合法/)
})
