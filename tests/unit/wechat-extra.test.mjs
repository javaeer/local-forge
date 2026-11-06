// 公众号排版扩展层单测：多端输出 / 模板 / 自定义主题 / 元数据 / 诊断 code 化 / 纯 JS ZIP。
// 纯 Node 运行，不依赖浏览器 / DOM / puppeteer。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RENDER_TARGETS, getTarget, targetLabel, targetHint,
  renderDocument, renderMarkdownTo,
  WECHAT_TEMPLATES, getTemplate, templateLabel,
  THEME_SCHEMA_VERSION, exportTheme, exportThemeBundle, importTheme,
  checkMetadata,
  buildStoreZip, zipEntry, publishPackageFiles,
  describeIssue, deriveIssues, ISSUE_MESSAGES,
} from '../../src/lib/wechat-extra.js'
import {
  parseDocument, parseBlocks, renderWechatArticle, validateWechatHtml,
  getTheme, sanitizeTheme, WECHAT_SAMPLE,
} from '../../src/lib/wechat.js'

const MD = `---
title: 多端渲染测试
description: 覆盖标题、段落、外链、代码块与列表
---

## 二级标题

这是 **粗体** 与 [外部链接](https://example.com/x) 的段落。

\`\`\`js
const a = 1
\`\`\`

- 列表项一
- 列表项二
`

/* ---------------- 多端输出 ---------------- */

test('RENDER_TARGETS 含 5 个目标，label/hint 均 5 语言齐全', () => {
  assert.deepEqual(RENDER_TARGETS.map((t) => t.id), ['wechat', 'zhihu', 'juejin', 'feishu', 'email'])
  const locales = ['zh-CN', 'en', 'ja-JP', 'ko-KR', 'es-ES']
  for (const t of RENDER_TARGETS) {
    for (const l of locales) {
      assert.ok(t.label[l], `${t.id}.label 缺 ${l}`)
      assert.ok(t.hint[l], `${t.id}.hint 缺 ${l}`)
    }
  }
  assert.equal(getTarget('不存在的目标').id, 'wechat')
  assert.equal(targetLabel('zhihu', 'ja-JP'), '知乎')
  assert.ok(targetHint('email', 'en').length > 0)
})

test('renderDocument(wechat) 与 renderWechatArticle 产物字节一致', () => {
  const a = renderDocument(parseDocument(MD), { target: 'wechat' })
  const b = renderWechatArticle(MD)
  assert.equal(a.html, b.html)
  assert.equal(a.target, 'wechat')
  assert.equal(a.report.ok, true)
  assert.ok(a.html.includes('<span leaf=""'))
})

test('通用目标输出语义 HTML：保留外链、代码块带 language-* class、不包 span[leaf]', () => {
  for (const target of ['zhihu', 'juejin', 'feishu']) {
    const r = renderDocument(parseDocument(MD), { target })
    assert.equal(r.target, target)
    assert.ok(r.html.includes('<h2'), `${target} 应有 h2`)
    assert.ok(r.html.includes('href="https://example.com/x"'), `${target} 应保留外链`)
    assert.ok(r.html.includes('class="language-js"'), `${target} 代码块应带 language class`)
    assert.ok(!r.html.includes('<span leaf=""'), `${target} 不应出现 span[leaf]`)
    assert.ok(!/position\s*:/i.test(r.html), `${target} 不应出现 position`)
    assert.equal(r.report.ok, true)
    assert.ok(r.previewHtml.includes('<!doctype html>'))
    assert.ok(r.plain.includes('二级标题'))
  }
})

test('email 目标：保守内联样式，无 class / position / grid / flex', () => {
  const r = renderDocument(parseDocument(MD), { target: 'email' })
  assert.ok(r.html.includes('style="'), 'email 应内联样式')
  assert.ok(r.html.includes('<div style="'), 'email 根容器应内联')
  assert.ok(!/\sclass=/i.test(r.html), 'email 不应依赖 class')
  assert.ok(!/[;"\s]position\s*:/i.test(r.html))
  assert.ok(!/display\s*:\s*grid/i.test(r.html))
  assert.ok(!/display\s*:\s*flex/i.test(r.html))
  assert.equal(r.report.target, 'email')
})

test('renderMarkdownTo 便捷入口：直接对字符串多端渲染', () => {
  const w = renderMarkdownTo(MD, { target: 'wechat' })
  const z = renderMarkdownTo(MD, { target: 'zhihu' })
  assert.ok(w.html.includes('<span leaf=""'))
  assert.ok(z.html.includes('href="https://example.com/x"'))
})

test('styleMapping 可覆盖样式映射（三层解耦之「样式映射层」）', () => {
  const custom = { h2: { color: '#ff0000', 'font-size': '99px' } }
  const r = renderDocument(parseDocument(MD), { target: 'wechat', styleMapping: custom })
  assert.ok(r.html.includes('color:#ff0000'), '自定义 h2 样式应生效')
  assert.ok(r.html.includes('font-size:99px'))
  assert.equal(r.report.ok, true)
})

test('未知 target 安全回退到 wechat，不抛错', () => {
  const r = renderDocument(parseDocument(MD), { target: 'not-exist' })
  assert.ok(r.html.includes('<span leaf=""'))
})

/* ---------------- 文章模板 ---------------- */

test('WECHAT_TEMPLATES 4 套，name 5 语言，Markdown 均可编译且 0 错误', () => {
  assert.equal(WECHAT_TEMPLATES.length, 4)
  const locales = ['zh-CN', 'en', 'ja-JP', 'ko-KR', 'es-ES']
  for (const t of WECHAT_TEMPLATES) {
    for (const l of locales) assert.ok(t.name[l], `${t.id}.name 缺 ${l}`)
    assert.ok(t.md.length > 60)
    const r = renderWechatArticle(t.md)
    assert.equal(r.report.errors.length, 0, `${t.id} 编译报错: ${JSON.stringify(r.report.errors)}`)
    assert.ok(r.html.length > 200)
  }
  assert.equal(getTemplate('不存在的模板').id, 'blank')
  assert.equal(templateLabel('weekly', 'en'), 'Weekly report')
})

test('模板覆盖全部新增结构化模块（timeline/compare/steps/code-title）', () => {
  const all = WECHAT_TEMPLATES.map((t) => t.md).join('\n')
  for (const m of ['timeline', 'compare', 'steps', 'code-title']) {
    assert.ok(all.includes(`:::${m}`), `模板应演示 :::${m}`)
  }
  // 新增模块能被 parseBlocks 识别
  const types = parseBlocks(WECHAT_TEMPLATES.find((t) => t.id === 'tutorial').md).blocks
  assert.ok(types.some((b) => b.type === 'module' && b.name === 'steps'))
  assert.ok(types.some((b) => b.type === 'module' && b.name === 'code-title'))
})

test('扩容模块渲染：对比表支持多列、时间轴/步骤带序号、code-title 带 pre', () => {
  const cmp = renderWechatArticle(':::compare\n维度 | A | B\n易用 | 高 | 中\n:::').html
  assert.ok(cmp.includes('<th'))
  assert.ok(cmp.includes('B')) // 第 3 列不被丢弃
  const tl = renderWechatArticle(':::timeline\n2020 | 起点 | 说明\n2021 | 发布 | 说明2\n:::').html
  assert.ok(tl.includes('①'))
  assert.ok(tl.includes('②'))
  const ct = renderWechatArticle(':::code-title\ntitle: 示例\nlang: js\nconst x = 1\n:::').html
  assert.ok(ct.includes('<pre'))
  assert.ok(ct.includes('const x = 1'))
})

/* ---------------- 自定义主题 ---------------- */

test('exportTheme / importTheme 往返，schemaVersion 正确', () => {
  const json = exportTheme({ id: 'mine', name: '我的主题', primary: '#ff0000', accent: '#00ff00' })
  const parsed = JSON.parse(json)
  assert.equal(parsed.schemaVersion, THEME_SCHEMA_VERSION)
  assert.equal(parsed.id, 'mine')
  const r = importTheme(json)
  assert.equal(r.ok, true)
  assert.equal(r.theme.primary, '#ff0000')
  assert.equal(r.theme.name, '我的主题')
  assert.deepEqual(r.issues, [])
})

test('importTheme：非法 JSON 与版本不符返回 code 化错误', () => {
  const bad1 = importTheme('{not json')
  assert.equal(bad1.ok, false)
  assert.equal(bad1.issues[0].code, 'theme-invalid-json')
  const bad2 = importTheme(JSON.stringify({ schemaVersion: 999, id: 'x' }))
  assert.equal(bad2.ok, false)
  assert.equal(bad2.issues[0].code, 'theme-schema-mismatch')
  assert.equal(bad2.issues[0].params.v, 999)
})

test('sanitizeTheme 拦截 CSS 注入：非法颜色回退默认并给出 theme-bad-color 警告', () => {
  const evil = 'red;position:fixed;background:url(javascript:alert(1))'
  const r = importTheme(JSON.stringify({ schemaVersion: THEME_SCHEMA_VERSION, id: 'evil', primary: evil }))
  assert.equal(r.ok, true)
  assert.equal(r.theme.primary, getTheme('ink').primary, '非法主色应回退默认')
  assert.ok(r.issues.some((i) => i.code === 'theme-bad-color' && i.params.field === 'primary'))
  // 净化后的主题可直接用于编译，产物仍不含 position
  const out = renderWechatArticle('## 标题\n\n**重点**', { theme: r.theme })
  assert.ok(!/[;"\s]position\s*:/i.test(out.html))
  assert.equal(out.report.ok, true)
  assert.equal(sanitizeTheme({ primary: '#abcdef' }).primary, '#abcdef')
})

test('exportThemeBundle / importTheme 支持多主题 bundle', () => {
  const bundle = exportThemeBundle([
    { id: 'a', name: 'A', primary: '#111111' },
    { id: 'b', name: 'B', primary: '#222222' },
  ])
  const r = importTheme(bundle)
  assert.equal(r.ok, true)
  assert.equal(r.themes.length, 2)
  assert.equal(r.themes[1].primary, '#222222')
})

/* ---------------- 元数据校对 ---------------- */

test('checkMetadata 统计标题/摘要/字数/阅读时长/图片/外链', () => {
  const md = '---\ntitle: 测试标题\ndescription: 这是摘要\n---\n\n' + '正文内容'.repeat(80) + '\n\n![图](a.png) [链接](https://a.com) [链接2](https://b.com)\n'
  const m = checkMetadata(md)
  assert.equal(m.title, '测试标题')
  assert.equal(m.digest, '这是摘要')
  assert.ok(m.chars > 300, `字数应 > 300，实际 ${m.chars}`)
  assert.ok(m.readMinutes >= 1)
  assert.equal(m.images, 1)
  assert.equal(m.links, 2)
  assert.equal(m.ok, true)
})

test('checkMetadata 对超长标题 / 缺标题 / 缺摘要 / 过短正文给出 code 化告警', () => {
  const long = checkMetadata('---\ntitle: ' + '标'.repeat(80) + '\n---\n\n' + '内容'.repeat(200))
  assert.ok(long.issues.some((i) => i.code === 'meta-title-too-long'))
  assert.ok(long.issues.some((i) => i.code === 'meta-no-digest'))
  const bare = checkMetadata('短')
  assert.ok(bare.issues.some((i) => i.code === 'meta-title-missing'))
  assert.ok(bare.issues.some((i) => i.code === 'meta-too-short'))
  for (const i of bare.issues) {
    assert.ok(i.code && i.level && typeof i.params === 'object')
  }
  assert.ok(bare.warnings.length > 0)
})

/* ---------------- 诊断 code 化 ---------------- */

test('ISSUE_MESSAGES 每个 code 五语言齐全且无空文案', () => {
  const codes = Object.keys(ISSUE_MESSAGES)
  assert.ok(codes.length >= 25)
  for (const [code, row] of Object.entries(ISSUE_MESSAGES)) {
    assert.equal(row.length, 5, `${code} 语言数不为 5`)
    for (const s of row) assert.ok(typeof s === 'string' && s.length > 0, `${code} 有空文案`)
  }
})

test('describeIssue 按语言本地化并替换占位符', () => {
  const issue = { code: 'img-not-localized', params: { src: 'a.png' }, level: 'error' }
  assert.ok(describeIssue(issue, 'zh-CN').includes('图片未本地化'))
  assert.ok(describeIssue(issue, 'zh-CN').includes('a.png'))
  assert.ok(describeIssue(issue, 'en').includes('not localized'))
  assert.ok(describeIssue(issue, 'ja-JP').includes('ローカル化'))
  assert.ok(describeIssue(issue, 'ko-KR').includes('로컬화'))
  assert.ok(describeIssue(issue, 'es-ES').includes('localizada'))
  // 未知语言回退 zh-CN；未知 code 返回 code 本身
  assert.ok(describeIssue(issue, 'xx-XX').includes('图片未本地化'))
  assert.equal(describeIssue({ code: 'no-such-code' }), 'no-such-code')
})

test('deriveIssues 把 code 化问题按 level 拆成 errors/warnings', () => {
  const d = deriveIssues([
    { code: 'denied-tag', params: { tag: 'script' }, level: 'error' },
    { code: 'fixed-px-width', params: {}, level: 'warning' },
  ], 'en')
  assert.equal(d.errors.length, 1)
  assert.equal(d.warnings.length, 1)
  assert.ok(d.errors[0].includes('script'))
  assert.ok(d.warnings[0].includes('Fixed'))
})

test('validateWechatHtml 返回 code 化 issues 且兼容 errors/warnings 字符串', () => {
  const bad = '<section class="x" style="position:fixed;color:red"><span leaf=""><p>块</p></span></section>'
  const v = validateWechatHtml(bad)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('class')))
  assert.ok(v.errors.some((e) => e.includes('position')))
  assert.ok(v.issues.length >= 3)
  for (const i of v.issues) assert.ok(i.code && i.level && typeof i.params === 'object')
  const codes = v.issues.map((i) => i.code)
  assert.ok(codes.includes('residual-class-id'))
  assert.ok(codes.includes('style-denied-prop'))
  assert.ok(codes.includes('leaf-block-child'))
})

test('renderWechatArticle 的 report 携带 code 化 issues（图片未本地化）', () => {
  const r = renderWechatArticle('![图](https://cdn.example.com/a.png)')
  assert.equal(r.report.ok, false)
  assert.ok(r.report.errors.some((e) => e.includes('图片未本地化')))
  assert.ok(r.report.issues.some((i) => i.code === 'img-not-localized' && i.params.src.includes('cdn.example.com')))
})

test('示例文档编译后 issues 全部 code 化且无 error', () => {
  const r = renderWechatArticle(WECHAT_SAMPLE)
  assert.equal(r.report.errors.length, 0)
  for (const i of r.report.issues) assert.ok(i.code && i.level)
})

/* ---------------- 纯 JS ZIP ---------------- */

// 最小 store-ZIP 读取器，交叉验证 buildStoreZip 的结构与内容（零依赖）
function readStoreZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break }
  }
  assert.ok(eocd >= 0, '能找到 EOCD')
  const n = dv.getUint16(eocd + 10, true)
  const cdStart = dv.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const out = {}
  let off = cdStart
  for (let k = 0; k < n; k++) {
    assert.equal(dv.getUint32(off, true), 0x02014b50, 'central directory 签名')
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    const localOff = dv.getUint32(off + 42, true)
    const name = dec.decode(bytes.subarray(off + 46, off + 46 + nameLen))
    assert.equal(dv.getUint32(localOff, true), 0x04034b50, 'local header 签名')
    const lNameLen = dv.getUint16(localOff + 26, true)
    const lExtraLen = dv.getUint16(localOff + 28, true)
    const size = dv.getUint32(localOff + 22, true)
    const start = localOff + 30 + lNameLen + lExtraLen
    out[name] = dec.decode(bytes.subarray(start, start + size))
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

test('zipEntry 规范化 string / Uint8Array / dataURL', () => {
  assert.ok(zipEntry('a.txt', 'hello').data instanceof Uint8Array)
  assert.equal(new TextDecoder().decode(zipEntry('a.txt', 'hello').data), 'hello')
  assert.ok(zipEntry('b.bin', new Uint8Array([1, 2, 3])).data.length === 3)
  const png = 'data:image/png;base64,aGVsbG8=' // "hello"
  assert.equal(new TextDecoder().decode(zipEntry('c.png', png).data), 'hello')
})

test('buildStoreZip 生成可被标准读取器解析的 ZIP（含中文文件名）', () => {
  const files = [
    zipEntry('article.md', '# 标题'),
    zipEntry('说明.txt', '中文内容 ✓'),
    zipEntry('nested/a.json', '{"ok":true}'),
  ]
  const bytes = buildStoreZip(files)
  assert.ok(bytes instanceof Uint8Array)
  assert.ok(bytes.length > 100)
  const back = readStoreZip(bytes)
  assert.equal(back['article.md'], '# 标题')
  assert.equal(back['说明.txt'], '中文内容 ✓')
  assert.equal(back['nested/a.json'], '{"ok":true}')
})

test('publishPackageFiles 含 md/html/report/meta/README，图片 dataURL 可还原', () => {
  const md = '---\ntitle: 打包测试\n---\n\n正文 ![封面](cover.png)\n'
  const r = renderWechatArticle(md, { images: { 'cover.png': { src: 'data:image/png;base64,aGVsbG8=', w: 10, h: 10 } } })
  const files = publishPackageFiles({
    md, html: r.html, images: { 'cover.png': { src: 'data:image/png;base64,aGVsbG8=' } },
    report: r.report, meta: r.meta, title: r.title, target: 'wechat',
  })
  const names = files.map((f) => f.name)
  for (const n of ['article.md', 'article.html', 'report.txt', 'meta.json', 'README.txt']) {
    assert.ok(names.includes(n), `发布包缺 ${n}`)
  }
  assert.ok(names.some((n) => n.startsWith('images/') && n.endsWith('.png')), '应含还原后的图片')
  const zip = buildStoreZip(files)
  const back = readStoreZip(zip)
  assert.ok(back['article.html'].includes('<section'))
  assert.ok(back['report.txt'].includes('自检报告'))
  assert.ok(back['README.txt'].includes('从未上传'))
  assert.equal(back['images/1.png'], 'hello')
})
