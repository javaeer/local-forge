#!/usr/bin/env node
/**
 * InfinityFree 部署裁剪脚本
 *
 * 背景：InfinityFree 免费主机有硬性单文件大小限制，超限文件会被【自动删除】：
 *   - HTML / PHP / JS 文件：上限 1 MB
 *   - .htaccess：上限 10 KB
 *   - 其他所有文件：上限 10 MB
 *   - .wasm 也按「其他文件」计，即上限 10 MB
 *
 * LocalForge 的 dist 中有 2 个致命超限文件（ffmpeg 内核 32MB / 31MB），
 * 会被服务器静默删除。好在 src/lib/media.js 内置四级兜底：
 *   本地MT → CDN-MT → 本地ST → CDN-ST
 * 删掉本地内核后会自然落到 CDN（首次媒体转码需联网从 jsDelivr 拉取）。
 *
 * 本脚本产出 dist-infinityfree/：一个可直接上传到 InfinityFree htdocs 的版本。
 *
 * 用法：node scripts/prune-for-infinityfree.mjs
 */
import { cp, rm, readdir, stat, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = 'dist'
const OUT = 'dist-infinityfree'

// 单文件大小上限（字节）
const LIMITS = {
  '.html': 1 * 1024 * 1024,
  '.htm': 1 * 1024 * 1024,
  '.php': 1 * 1024 * 1024,
  '.js': 1 * 1024 * 1024,
  // 注意：.wasm.js 后缀按 .js 判定 → 1MB；.mjs 未被明确列出，按保守 1MB 处理
  '.mjs': 1 * 1024 * 1024,
  default: 10 * 1024 * 1024,
}

function limitFor(name) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.htaccess') || lower === '.htaccess') return 10 * 1024
  // 取最后一个扩展名判断（.wasm.js → .js → 1MB）
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot) : ''
  return LIMITS[ext] ?? LIMITS.default
}

async function walk(dir, base = dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p, base)))
    else out.push({ path: p, rel: relative(base, p), size: (await stat(p)).size })
  }
  return out
}

const fmt = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : (n / 1024).toFixed(0) + 'KB')

async function main() {
  if (!existsSync(SRC)) {
    console.error(`✗ 未找到 ${SRC}/，请先执行 pnpm build`)
    process.exit(1)
  }

  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const files = await walk(SRC)
  const kept = []
  const dropped = []

  for (const f of files) {
    const lim = limitFor(f.rel)
    if (f.size > lim) dropped.push({ ...f, lim })
    else kept.push(f)
  }

  for (const f of kept) {
    const parts = f.rel.split('/')
    if (parts.length > 1) await mkdir(join(OUT, ...parts.slice(0, -1)), { recursive: true })
    await cp(f.path, join(OUT, f.rel))
  }

  console.log(`\n📦 源产物 ${SRC}/：${files.length} 个文件`)
  console.log(`✅ 保留 ${kept.length} 个 → ${OUT}/`)
  console.log(`🗑️  剔除 ${dropped.length} 个（超 InfinityFree 单文件上限）\n`)

  if (dropped.length) {
    console.log('剔除清单：')
    for (const d of dropped) {
      console.log(`  ✗ ${d.rel.padEnd(48)} ${fmt(d.size).padStart(8)}  > 上限 ${fmt(d.lim)}`)
    }
    console.log('\n受影响功能：')
    if (dropped.some((d) => d.rel.includes('ffmpeg'))) {
      console.log('  · 媒体转换（MP4/MP3/WebM…）：本地内核被删 → 自动回退 jsDelivr CDN')
      console.log('    首次转码需联网下载约 32MB 内核，之后浏览器缓存复用')
    }
    if (dropped.some((d) => d.rel.includes('tesseract'))) {
      console.log('  · OCR 识别：本地内核被删 → 自动回退 jsDelivr CDN')
    }
    if (dropped.some((d) => d.rel.includes('pdf.worker'))) {
      console.log('  · PDF 解析：pdf.worker 被删 → 需确认 pdfjs workerSrc 回退（见下）')
    }
  }

  const total = kept.reduce((s, f) => s + f.size, 0)

  // 自动写入 InfinityFree 专用 .htaccess（避开被禁指令，见文件内注释）
  await writeFile(join(OUT, '.htaccess'), HTACCESS, 'utf8')
  console.log(`\n已生成 ${OUT}/.htaccess（InfinityFree 专用：AddType 修正 wasm MIME + SPA 回退）`)
  console.log(`上传体积：${fmt(total)}`)
  console.log(`将 ${OUT}/ 内【所有内容】上传到 InfinityFree 的 htdocs/ 目录（不要多套一层文件夹）\n`)
}

// InfinityFree 已禁用 Header/Expires/AddOutputFilterByType 等指令，写了会整站 502，
// 故此处只保留 mod_mime(AddType) 与 mod_rewrite。
const HTACCESS = `# LocalForge · InfinityFree 专用（由 scripts/prune-for-infinityfree.mjs 生成）
# 注意：InfinityFree 禁用了 Header/Expires/Deflate 相关指令，写了会导致整站 502，
#      因此这里只保留 AddType（修 wasm MIME）与 Rewrite（SPA 回退）。

<IfModule mod_mime.c>
  AddType application/wasm          .wasm
  AddType text/javascript           .js .mjs
  AddType application/manifest+json .webmanifest
  AddType image/svg+xml             .svg
  AddType font/woff2                .woff2
  AddType image/avif                .avif
  AddType image/webp                .webp
</IfModule>

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  # 真实文件/目录直接返回，防止 assets/*.js、*.wasm 被 SPA 回退吞成 HTML
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]
  RewriteRule ^ index.html [L]
</IfModule>

DirectoryIndex index.html
`

main().catch((e) => { console.error(e); process.exit(1) })
