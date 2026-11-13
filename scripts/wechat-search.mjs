#!/usr/bin/env node
// 公众号文章检索 · 命令行版
//
// 为什么需要 CLI：浏览器的 fetch 受同源策略约束，mp.weixin.qq.com 不下发 CORS 头，
// 网页端直连必然被拦（要么自建反代，要么走粘贴）。Node 没有这层限制，
// 因此「一次搜完一整本合集」这条最实用的路径交给本脚本；网页端复用同一份解析内核。
//
// 用法：
//   node scripts/wechat-search.mjs <文章链接>                    # 解析文章 + 展开所属合集
//   node scripts/wechat-search.mjs <文章链接> --grep "六年级 冀教版"
//   node scripts/wechat-search.mjs <文章链接> --all --md out.md
//   node scripts/wechat-search.mjs --biz MzY4... --album 4756... --csv out.csv
//   node scripts/wechat-search.mjs <文章链接> --images           # 顺带列出正文图片的 /0 原图
//
// 参数：
//   --grep <词...>   标题关键词，空格分隔 = AND，前缀 - 表示排除（如 "六年级 -测试卷"）
//   --all            翻完所有页（默认最多 10 页）
//   --pages <n>      最多翻页数
//   --json <file>    导出原始 JSON
//   --md <file>      导出 Markdown 表格
//   --csv <file>     导出 CSV（带 BOM）
//   --images         打印文章正文图片的原图直链
//   --quiet          只输出结果，不打印过程
//
// 说明：本脚本只读取公开页面，不登录、不写任何数据到微信；请控制频率，别把对方服务器当压测目标。

import { writeFileSync } from 'node:fs'
import {
  parseArticleRef, parseArticleHtml, resolveFromArticle, fetchAlbum, fetchAlbumTitle,
  filterArticles, sortArticles, summarize, toCsv, toMarkdown,
  toOriginalImageUrl, buildAlbumUrl, formatDate,
} from '../src/lib/wechat-search.js'

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN'

const args = process.argv.slice(2)
const flag = (name, def = '') => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? (args[i + 1] ?? '') : def
}
const has = (n) => args.includes('--' + n)
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))

const quiet = has('quiet')
const log = (...a) => { if (!quiet) console.log(...a) }

// 统一取数：带移动端 UA（不带 UA 时合集接口会返回 logicret:-3 空壳）
async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://mp.weixin.qq.com/' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`)
  return await res.text()
}

async function main() {
  const link = positional[0] || ''
  const bizArg = flag('biz')
  const albumArg = flag('album')
  const grep = flag('grep')
  const maxPages = has('all') ? 60 : Number(flag('pages')) || 10

  if (!link && !(bizArg && albumArg)) {
    console.log(`
公众号文章检索 · 用法

  node scripts/wechat-search.mjs <文章链接> [选项]
  node scripts/wechat-search.mjs --biz <__biz> --album <album_id> [选项]

选项
  --grep "六年级 冀教版"   标题关键词（空格=AND，-前缀=排除）
  --all                    翻完整个合集（默认最多 10 页）
  --images                 同时列出正文图片的 /0 原图直链
  --json/--md/--csv <file> 导出结果
  --quiet                  静默模式
`)
    process.exit(link ? 0 : 1)
  }

  let biz = bizArg
  let albumId = albumArg
  let albumTitle = ''
  let article = null

  // ① 给的是文章链接：先解析出 biz + 合集 id
  if (link) {
    const ref = parseArticleRef(link)
    if (!ref.url) {
      console.error('✗ 不是有效的公众号链接（需要 mp.weixin.qq.com）')
      process.exit(1)
    }
    log('· 拉取文章…')
    const r = await resolveFromArticle(link, getText)
    article = r.article
    biz = biz || r.biz
    albumId = albumId || r.albumId
    albumTitle = r.albumTitle

    console.log(`\n标题    ${article.title}`)
    console.log(`公众号  ${article.account || '(未识别)'}`)
    console.log(`发布    ${article.publishText || '(未识别)'}   正文约 ${article.chars} 字`)
    console.log(`合集    ${albumId ? `${albumTitle || '(未命名)'}  album_id=${albumId}` : '(该文未归入合集)'}`)
    console.log(`图片    ${article.images.length} 张`)

    if (has('images') && article.images.length) {
      console.log('\n原图直链（/0 = 上传原图；作者烧进像素的水印去不掉）：')
      article.images.forEach((u, i) => console.log(`  ${String(i + 1).padStart(2, '0')}  ${toOriginalImageUrl(u)}`))
    }
  }

  if (!albumId) {
    log('\n（没有合集可展开。合集是公众号唯一稳定的文章列举入口，单篇文章的「往期」需另寻入口）')
    return
  }

  // ② 翻合集
  log(`\n· 展开合集 ${albumId} …`)
  const t0 = Date.now()
  const { items, pages, albumTitle: at, truncated } = await fetchAlbum({
    biz, albumId, getText, maxPages,
    onPage: ({ page, got, total }) => log(`   第 ${page} 页 +${got} 篇（累计 ${total}）`),
  })
  const title = at || albumTitle || await fetchAlbumTitle({ biz, albumId, getText })
  if (!truncated && items.length === 0) {
    console.error('✗ 合集为空或解析失败：可能需要换 UA、链接已失效，或该合集不公开')
    process.exit(2)
  }

  const sorted = sortArticles(items, 'desc')
  const hit = grep ? filterArticles(sorted, { query: grep }) : sorted
  const stat = summarize(sorted)

  console.log(`\n合集    ${title || '(未命名)'}　共 ${items.length} 篇　${stat.from} ~ ${stat.to}　翻 ${pages} 页　${((Date.now() - t0) / 1000).toFixed(1)}s`)
  if (stat.editions.length) console.log(`版本    ${stat.editions.map((e) => `${e.key}×${e.count}`).join('　')}`)
  if (truncated) console.log('注意    达到翻页上限，结果可能不完整（加 --all 重试）')

  if (grep) {
    console.log(`\n检索    "${grep}" → 命中 ${hit.length} 篇`)
    if (!hit.length) {
      console.log('        没有匹配。可试：放宽关键词、去掉排除词，或换成版本名（人教版/北师大版/苏教版…）')
    }
  }

  const show = hit.slice(0, Number(flag('limit')) || 200)
  if (show.length) {
    console.log('')
    for (const it of show) {
      const tag = [it.edition, it.grade, it.subject].filter(Boolean).join('·')
      console.log(`${it.date}  ${tag ? `[${tag}] ` : ''}${it.title}`)
      console.log(`           ${it.url}`)
    }
    if (hit.length > show.length) console.log(`\n… 还有 ${hit.length - show.length} 篇（用 --limit 调整）`)
  }

  // ③ 导出
  const jsonFile = flag('json')
  if (jsonFile) {
    writeFileSync(jsonFile, JSON.stringify({
      album: { id: albumId, biz, title }, query: grep || '', generatedAt: new Date().toISOString(),
      article, items: hit,
    }, null, 2))
    log(`\n· 已写 ${jsonFile}`)
  }
  const mdFile = flag('md')
  if (mdFile) {
    writeFileSync(mdFile, toMarkdown(hit, {
      title: title || '公众号合集清单', account: article && article.account,
      albumId, query: grep, generatedAt: formatDate(Date.now()),
    }))
    log(`· 已写 ${mdFile}`)
  }
  const csvFile = flag('csv')
  if (csvFile) {
    writeFileSync(csvFile, toCsv(hit))
    log(`· 已写 ${csvFile}`)
  }
}

main().catch((e) => {
  console.error('✗ ' + (e && e.message ? e.message : e))
  if (e && e.code === 'cors') console.error('  浏览器直连会被 CORS 拦；本脚本在 Node 下运行不受限，请检查网络。')
  process.exit(3)
})
