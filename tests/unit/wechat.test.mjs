// 公众号排版内核单元测试：纯 Node 运行，不需要浏览器 / DOM / puppeteer。
// 跑法：node --test tests/unit/wechat.test.mjs  （或 pnpm test:unit）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WECHAT_THEMES, WECHAT_SAMPLE, getTheme, parseFrontmatter, parseBlocks,
  renderWechatArticle, validateWechatHtml, cssText, ALLOWED_CSS,
} from '../../src/lib/wechat.js'

const render = (md, opts) => renderWechatArticle(md, opts)

test('主题表完整，getTheme 有兜底', () => {
  assert.ok(WECHAT_THEMES.length >= 3)
  assert.equal(getTheme('not-exist').id, WECHAT_THEMES[0].id)
  assert.equal(getTheme('orange').name, '橙心')
})

test('Frontmatter 解析：title / author / theme，正文不含 ---', () => {
  const { meta, body } = parseFrontmatter('---\ntitle: 测试\nauthor: 我\ntheme: orange\n---\n\n# 正文\n')
  assert.equal(meta.title, '测试')
  assert.equal(meta.author, '我')
  assert.equal(meta.theme, 'orange')
  assert.match(body, /^# 正文/)
  assert.doesNotMatch(body, /^---/)
  const plain = parseFrontmatter('# 没有 frontmatter')
  assert.deepEqual(plain.meta, {})
})

test('块级解析：标题 / 列表 / 引用 / 警告块 / 表格 / 代码 / 模块 / 脚注定义', () => {
  const { blocks, footnotes } = parseBlocks(`# 标题
- 一
- [x] 完成

> 引用

> [!NOTE]
> 提示

| A | B |
| --- | --- |
| 1 | 2 |

\`\`\`js
const a = 1
\`\`\`

:::hero
title: 刊头
:::

[^1]: 脚注内容
`)
  const types = blocks.map((b) => b.type)
  for (const t of ['heading', 'list', 'quote', 'alert', 'table', 'code', 'module']) {
    assert.ok(types.includes(t), `缺少块类型 ${t}`)
  }
  assert.equal(footnotes.length, 1)
  assert.equal(footnotes[0].label, '1')
  assert.equal(blocks.find((b) => b.type === 'module').name, 'hero')
  assert.equal(blocks.find((b) => b.type === 'alert').kind, 'note')
})

test('编译产物满足公众号硬约束：无 class/id/var()/font-family/position，全部内联', () => {
  const r = render('# 标题\n\n这是 **粗体** 与 `代码` 的段落。\n')
  assert.match(r.html, /<section style="/)
  assert.match(r.html, /<span leaf=""/)
  for (const bad of [/\sclass=/i, /\sid=/i, /var\(/i, /font-family/i, /position\s*:/i, /<style\b/i]) {
    assert.doesNotMatch(r.html, bad, `产物不应包含 ${bad}`)
  }
  assert.ok(r.html.includes('<strong'))
  assert.ok(r.html.includes('<code'))
  assert.ok(r.previewHtml.includes('<!doctype html>'))
  assert.ok(r.plain.includes('标题'))
  assert.ok(r.stats.blocks > 0)
  assert.equal(r.report.ok, true, JSON.stringify(r.report.errors))
})

test('cssText 过滤非白名单属性', () => {
  assert.ok(ALLOWED_CSS.has('border-left'))
  const s = cssText({ color: 'red', 'font-family': 'serif', position: 'absolute', 'font-size': '16px' })
  assert.equal(s, 'color:red;font-size:16px')
})

test('外链转文末参考资料，mp.weixin.qq.com 链接保留', () => {
  const r = render('参考 [外部](https://example.com/a) 与 [微信](https://mp.weixin.qq.com/s/abc)')
  assert.match(r.html, /参考资料/)
  assert.match(r.html, /example\.com\/a/)
  assert.match(r.html, /href="https:\/\/mp\.weixin\.qq\.com\/s\/abc"/)
  assert.equal(r.stats.links, 1)
  assert.equal(r.report.ok, true)
})

test('图片：外链报错并降级占位，本地 DataURL 通过', () => {
  const bad = render('![图](https://cdn.example.com/a.png)')
  assert.equal(bad.report.ok, false)
  assert.ok(bad.report.errors.some((e) => e.includes('图片未本地化')))
  assert.match(bad.html, /图片待本地化/)

  const png = 'data:image/png;base64,iVBORw0KGgo='
  const ok = render(`![图](${png})`)
  assert.ok(ok.html.includes(`src="${png}"`))
  assert.equal(ok.stats.images, 1)
  assert.equal(ok.report.ok, true)
})

test('images 映射可用文件名把相对路径替换为本地 DataURL', () => {
  const dataUrl = 'data:image/png;base64,AAAA'
  const r = render('![封面](./images/cover.png)', { images: { 'cover.png': { src: dataUrl, w: 800, h: 450 } } })
  assert.ok(r.html.includes(dataUrl))
  assert.ok(r.html.includes('data-w="800"'))
  assert.equal(r.report.ok, true)
})

test('任务列表用 Unicode 替代 checkbox；代码块换行与缩进做微信适配', () => {
  const r = render('- [x] 已完成\n- [ ] 待办\n\n```js\n  const a = 1\n  // 注释\n```\n')
  assert.ok(r.html.includes('☑'))
  assert.ok(r.html.includes('☐'))
  assert.ok(r.html.includes('<br>'))
  assert.ok(r.html.includes('\u00A0'))
  assert.ok(r.html.includes('overflow-x:auto'))
  assert.equal(r.stats.code, 1)
})

test('结构化模块：:::hero 生成刊头，未知模块降级并告警', () => {
  const r = render(':::hero\neyebrow: TECH\ntitle: 主标题\nsubtitle: 副标题\ntags: A | B\n:::\n\n:::cards[目录]\nPART 01 | 开场 | 说明 | accent\n:::\n')
  assert.ok(r.html.includes('主标题'))
  assert.ok(r.html.includes('PART 01'))
  assert.equal(r.stats.modules, 2)
  assert.equal(r.report.ok, true)

  const unknown = render(':::whatever\nfoo: bar\n:::\n')
  assert.ok(unknown.report.warnings.some((w) => w.includes('未知排版模块')))
})

test('中文排版：中英文自动加空格可开关', () => {
  const on = render('使用LocalForge排版').html
  const off = render('使用LocalForge排版', { smartSpace: false }).html
  assert.match(on, /使用 LocalForge 排版/)
  assert.doesNotMatch(off, /使用 LocalForge 排版/)
})

test('XSS：Markdown 中的原始 HTML 被转义，不进入产物', () => {
  const r = render('普通 <script>alert(1)</script> 文本')
  assert.doesNotMatch(r.html, /<script>/)
  assert.ok(r.html.includes('&lt;script&gt;'))
  assert.equal(r.report.ok, true)
})

test('静态校验器能检出官方红线', () => {
  const bad = '<section class="x" style="position:fixed;color:red"><span leaf=""><p>块</p></span></section>'
  const v = validateWechatHtml(bad)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('class')))
  assert.ok(v.errors.some((e) => e.includes('position')))
  assert.ok(v.errors.some((e) => e.includes('span[leaf]')))
  assert.ok(v.stats.inlineStyles >= 1)
})

test('示例文档可直接编译并通过自检', () => {
  const r = render(WECHAT_SAMPLE)
  assert.ok(r.html.length > 1000)
  assert.equal(r.title, '用 LocalForge 排版一篇公众号文章')
  // 示例里的外链会被转成参考资料，不应残留 <a href="https://github.com/...">
  assert.equal(r.report.errors.length, 0, JSON.stringify(r.report.errors))
  assert.match(r.html, /参考资料/)
})

test('主题切换会改变主色，且始终不写 font-family', () => {
  const a = render('## 二级标题\n\n**重点**', { theme: 'ink' }).html
  const b = render('## 二级标题\n\n**重点**', { theme: 'orange' }).html
  assert.notEqual(a, b)
  assert.ok(b.includes('#ea580c'))
  assert.doesNotMatch(b, /font-family/)
})

test('UI 显式主题优先于 frontmatter；未传 opts.theme 时 frontmatter 兜底', () => {
  // 回归：视图的主题选择器曾因 frontmatter 的 `theme:` 覆盖而失效（点了没反应）
  const md = '---\ntitle: 主题优先级\ntheme: ink\n---\n\n## 二级标题\n\n**重点**\n'
  const a = render(md, { theme: 'ink' }).html
  const b = render(md, { theme: 'orange' }).html
  assert.notEqual(a, b, '显式 opts.theme 必须能覆盖 frontmatter')
  assert.ok(b.includes('#ea580c'))
  assert.equal(render(md).html, a, '未传 opts.theme 时仍应沿用 frontmatter')
})
