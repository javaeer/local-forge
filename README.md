<p align="center">
  <img src="public/favicon.svg" width="56" alt="LocalForge" />
</p>

<h1 align="center">LocalForge</h1>

<p align="center">
  <b>纯浏览器端的本地工坊</b> —— 文件、数据与知识皆是原料，55 道工序在本地锤炼成可用成果：<br/>
  <b>压缩、解压、转码、PDF、图片、OCR、离线词典、诗词格律、中医经典……原料进、成品出，全程不出本机。</b>
</p>

<p align="center">
  <a href="https://github.com/javaeer/local-forge/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/javaeer/local-forge/ci.yml?branch=main&label=build" alt="build" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/javaeer/local-forge" alt="license" /></a>
  <a href="https://github.com/javaeer/local-forge/releases"><img src="https://img.shields.io/github/v/release/javaeer/local-forge" alt="release" /></a>
  <a href="https://forge.freedev.app/"><img src="https://img.shields.io/website?url=http%3A%2F%2Fforge.freedev.app%2F&label=demo" alt="demo" /></a>
  <img src="https://img.shields.io/badge/made%20with-Vue%203-42b883" alt="vue" />
  <img src="https://img.shields.io/badge/100%25-client--side-0f172a" alt="client-side" />
</p>

> **LocalForge** —— 一座装在你浏览器里的本地工坊。受 LocalForge 启发并大幅扩展：
> 没有后端、没有上传、没有追踪。原料在你自己的设备里，被 zip.js / libarchive.js / ffmpeg.wasm 等工序锤炼成成品，用完即销毁。

---

## 在线体验

**[本地工坊](https://forge.freedev.app/)** —— Your files never leave your browser.

---

## 功能矩阵

| 分类 | 能力 | 实现 |
|---|---|---|
| **ZIP 工具箱** | 压缩为 ZIP（AES-256 密码、分卷拆分、压缩级别）／解压（含加密）／**分卷 ZIP 解压（多卷自动合并）**／多归档合并／格式互转 | [@zip.js/zip.js](https://github.com/gildas-lormeau/zip.js) 2.15 |
| **创建归档** | ZIP / TAR / TAR.GZ（自研可靠写入器，正确处理嵌套路径） | 自研 `writers.js`（USTAR） |
| **解压 / 提取** | RAR / 7Z / TAR / ISO / APK / DMG / WIM / DNG 等 200+ 格式；**分卷 ZIP 合并解压** | [libarchive.js](https://github.com/libarchive/libarchive.js) 2.0 (WASM) |
| **媒体转换** | MP4↔WebM↔MOV、MP4→MP3、WAV↔MP3、降码率压缩；**支持从 ZIP 内提取媒体** | [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) 0.12（多线程优先 → 单线程回退 → CDN） |
| **图片** | PNG / JPG / WEBP 互转、有损压缩（TinyPNG 同款 PNG 量化保透明）、**改尺寸（等比/精确/填满）**、**文字水印（9 宫格 + 平铺）**、本地预览 | Canvas API + [upng-js](https://github.com/photopea/UPNG.js) |
| **批处理队列** | 一次拖入多份文件，套用同一操作 + 预设（网页优化 / 极限压缩 / 去 EXIF / 改尺寸 / 水印 / PDF 瘦身 / 打包），串行执行、逐项进度、可取消、结果可打包 ZIP | 复用各引擎，`src/lib/batch.js` |
| **文档转换** | Markdown → PDF / HTML（自带零依赖解析器）；含中日韩时 PDF 自动切换 canvas 渲染通道，无需内嵌字体 | 自研 `docconvert.js` + pdf-lib |
| **公众号排版** | Markdown → 微信兼容的**纯内联样式 HTML**：三层解耦内核 + 5 端输出（微信/知乎/掘金/飞书/邮件）、4 套文章模板、14 个结构化模块、自定义主题 JSON 导入导出、图片压缩/粘贴截图/SVG→PNG、元数据校对、code 化诊断（5 语言）、校验报告、离线发布包、批量排版、草稿历史，一键复制富文本到剪贴板 | 自研零依赖内核 [`src/lib/wechat.js`](src/lib/wechat.js) + [`src/lib/wechat-extra.js`](src/lib/wechat-extra.js)（无新增依赖、不调用任何微信接口、不联网） |
| **公众号检索** | 公众号没有公开搜索接口，本工具以**合集（album）**为入口：从任意一篇文章反查出 `__biz + album_id`，翻页拉全整本合集的标题/时间/链接，本地关键词过滤（空格=AND、`-词`=排除）、版本/年级/学科自动归类、正文图片改写为 `/0` 原图直链；结果导出 CSV / Markdown / JSON。浏览器端走「代理 / 粘贴」两条路（明示 CORS 约束），Node CLI 无此限制 | 自研零依赖纯内核 [`src/lib/wechat-search.js`](src/lib/wechat-search.js) + CLI [`scripts/wechat-search.mjs`](scripts/wechat-search.mjs)（解析不联网） |
| **App 图标生成** | 已有 Logo 一次裁剪/留白，批量导出 **19 个尺寸**：App Store 1024 / Google Play 512 / iOS 传统 12 档 / Android 5 档；裁剪填满或纯色背景、拖放与粘贴、实时预览、单文件与扁平 ZIP 下载、尺寸/体积/alpha 通道自检 | 自研零依赖纯内核 [`src/lib/app-icon.js`](src/lib/app-icon.js)（Node 可单测）+ `upng-js`（**App Store 产物输出 colorType=2，无 alpha 通道**，规避 ITMS-90717）；复用 `image.js` 解码与 `wechat-extra.js` 的纯 JS ZIP |
| **PDF** | 重压缩（内嵌图像重压 + 对象流去重）／**逐页预览（pdf.js 本地渲染）／合并多个 PDF／拆分为单页** | [pdf-lib](https://github.com/Hopding/pdf-lib) + [pdfjs-dist](https://github.com/mozilla/pdf.js) |
| **分享 / 安全** | WebRTC P2P 直传（手动 SDP 信令，无后端）；ZIP 密码字典恢复；归档修复 | WebRTC / 本地引擎 |
| **PWA / 离线** | 可安装（manifest + Service Worker）；**按需预缓存 WASM 内核**，断网也能用；缓存策略：外壳 network-first、内核 cache-first、静态资源 stale-while-revalidate | 自研 `public/sw.js` |
| **知识矿藏 · 离线词典** | CC-CEDICT 汉英词库（约 12 万条）在后台线程建索引与检索；支持汉字、带调拼音、无调拼音、首字母、英文释义五种查法，英文查义走倒排索引（`bicycle` 0.2 ms 出结果）、支持多词 AND（`green tea`）、繁体前缀展开，模糊纠错可选；英文单词附 IPA 音标（美/英 19 万词，可朗读）；可导入 CC-CEDICT / Kaikki JSONL / TSV 换源，导入的词库经 IndexedDB 持久化；词库进 SW 预缓存，访一次即可彻底断网查词 | 自研零依赖内核 [`src/lib/dict.js`](src/lib/dict.js)（Node 可单测）+ Web Worker（[`dict.worker.js`](src/lib/dict.worker.js) / [`dictclient.js`](src/lib/dictclient.js)，主线程零重活、Worker 不可用自动降级）+ 原生 `DecompressionStream`；词库由 `pnpm dict:fetch` 拉取（CC BY-SA 4.0）；音标来自 [ipa-dict](https://github.com/open-dict-data/ipa-dict)（MIT） |
| **媒体获取** | 粘贴媒体直链（含 m3u8 分片）在本地逐条拉取并显示进度，多分片可本地合并；跨域可选「自托管桥接」模式，地址只存本机 localStorage | 内核 [`src/lib/mediadl.js`](src/lib/mediadl.js)（纯函数 Node 可单测，ffmpeg 管线懒加载）+ 复用 `media.js` 的 concat 合并；不内置任何第三方解析后端 |
| **多语言** | 中文 / English / 日本語 / 한국어 / Español 五语界面，自动检测系统语言 + 持久化 | 零依赖 i18n 内核 `src/lib/i18n.js` |
| **知识矿藏 · 近体诗格律** | 按平水韵 106 韵部逐字校勘平仄、粘对与押韵，指出出律、孤平、三平调、拗救 | 自研零依赖内核 `src/lib/poemmeter.js` |
| **知识矿藏 · 词牌格律** | 按钦定词谱 818 调 2475 体校勘，词林正韵 19 部判韵，附填词助手 | 自研零依赖内核 `src/lib/cimeter.js` |
| **知识矿藏 · 诗文精选** | 唐诗三百首、宋词三百首、古文观止共 868 篇，本地检索阅读，可导出竖排卡片 | 自研 `src/lib/poems.js` + 全量库 Worker 检索 |
| **知识矿藏 · 中医药歌诀** | 汤头歌诀、濒湖脉学、药性歌括四百味等八本 1143 条，遮盖背诵与默写比对（LCS 评分） | 自研零依赖内核 `src/lib/tcmchants.js` |
| **知识矿藏 · 本草纲目** | 16 部 52 卷 1775 条药条与主治全文，目录树浏览、药名主治检索，全量库可下载离线阅读 | 自研 `src/lib/bencao.js` + IndexedDB |
| **知识矿藏 · 中医医典** | 千金要方、外台秘要、内经、伤寒论等九部医典 5954 篇，篇章目录 + Worker 全文检索 | 自研 `src/lib/tcmfull.js` + 17 分片 |

> **关于 7Z / ISO / XZ / ZST / BZ2 的「创建」**：这些格式需要原版专有的 WASM 编码模块（网页端不可得），
> 本项目**不伪造**其创建能力——`createArchive` 对不支持的格式会明确报错并建议改用 ZIP / TAR / TAR.GZ。
> 但其**解压 / 提取**由 libarchive.js 完整覆盖，可放心使用。

---

## 快速开始（本地开发）

```bash
corepack enable          # 启用 pnpm（推荐；本项目用 pnpm 锁文件）
pnpm install
pnpm dev                 # 开发服务器 http://localhost:5173
pnpm build               # 生产构建到 dist/
pnpm preview             # 预览构建产物（默认 http://localhost:4173）
```

> 媒体转换依赖 ffmpeg 多线程内核，需要跨源隔离头（`COOP/COEP`）。
> 开发服务器已在 `vite.config.js` 的 `server.headers` / `preview.headers` 中配好；
> 生产部署见下方「部署」。若页面未启用跨源隔离，内核会自动回退到单线程，功能不变、仅转码稍慢。

## 端到端测试

```bash
pnpm test:e2e                # 基础归档能力（默认 http://localhost:5173，可用 BASE_URL 覆盖）
pnpm test:e2e:layout         # 布局/导航
pnpm test:e2e:features       # PWA / i18n / 跨工具工作流 / 历史筛选
pnpm test:e2e:offline        # 离线内核按需预缓存（SW 协议）
pnpm test:e2e:largefile      # 大文件流式读取 + 体积门禁
pnpm test:e2e:progress       # 阶段进度模型
pnpm test:e2e:batch          # 批处理队列
pnpm test:e2e:imagepro       # 图片改尺寸 / 水印
pnpm test:e2e:doc            # Markdown → PDF / HTML
pnpm test:e2e:wechat         # 公众号排版 16 项（产物结构 / 规范自检 / 多端输出 / 模板与草稿 / 零跨域请求）
pnpm test:e2e:appicon        # App 图标生成器 21 项（尺寸预设 / 无 alpha 通道 / ZIP 字节解析 / 零跨域请求）
pnpm test:e2e:dictionary     # 离线词典 13 项（词库装载 / Worker 生效 / 五种检索 / IPA 音标 / 展开复制 / 首页卡片 / 零跨域请求）
pnpm test:e2e:mediafetch     # 媒体获取 12 项（直链解析 / 按钮门槛 / 桥接持久化 / 首页卡片 / 零外发请求）
pnpm test:e2e:i18n           # 中日英韩西五语切换
pnpm report:kernels          # 内核体积报告（构建产物 vs 实际下载）
pnpm prune:infinityfree      # 生成 InfinityFree 兼容产物（剔除超限文件 + 专用 .htaccess）
```

测试基于 `puppeteer-core` + 真实 Chromium 驱动浏览器。针对构建产物运行时，用
`BASE=http://localhost:4173 pnpm test:e2e:xxx`（`vite preview`）覆盖默认端口。

`pnpm test:e2e` 用 `puppeteer-core` + 真实 Chromium 驱动浏览器，覆盖：ZIP/TAR/TAR.GZ 创建（含嵌套路径）、
AES 密码加解密回环、无密码/错密码正确拒绝、格式转换、多归档合并、不支持格式报错、归档修复、嵌套 tar 提取、
**分卷 ZIP 合并解压**、**PDF 合并/拆分为单页**——全部通过且控制台零运行时错误
（`_e2e_media.mjs` / `_e2e_media2.mjs` 另覆盖媒体内核与 ZIP 内提取媒体）。

---

## 部署（让他人能在线访问）

LocalForge 是纯静态站点，构建产物即 `dist/`。任意静态托管均可，但**媒体转换的多线程内核需要跨源隔离头**，
因此推荐以下平台（均已提供配置文件）：

| 平台 | 配置 | 跨源隔离(多线程) | 注意 |
|---|---|---|---|
| **Vercel** | `vercel.json` | ✅ | 大文件上限宽松，可直接托管 32MB ffmpeg wasm |
| **Netlify** | `netlify.toml` | ✅ | 同上 |
| **Cloudflare Pages** | `public/_headers` + `public/_redirects` | ✅ | ⚠️ 免费版单文件上限 25MB，**32MB 的 ffmpeg wasm 无法上传**，会自动回退到 jsDelivr CDN（功能正常，运行时从 CDN 拉内核） |
| **Nginx / 宝塔** | 见 `deploy-fix/nginx.conf` | ✅ | 需手动配置 wasm MIME + COOP/COEP + SPA 回退 |
| **Apache / cPanel** | 见 `deploy-fix/.htaccess` | ✅ | 同上 |
| **GitHub Pages** | 需自行加 `base` 并在 Actions 注入 `COOP/COEP` 头 | ⚠️ 默认无 | 未配置跨源隔离时回退单线程内核；GitHub Pages 不易自定义响应头，建议优先前三者或自定义域名 + Cloudflare |
| **InfinityFree** | `pnpm prune:infinityfree` | ⚠️ 不可用 | 单文件上限 10MB(JS 1MB) 且有禁用的 .htaccess 指令 → 见下方专节 |

所有配置文件都为 `/` 设置了 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp`，
并配置 SPA 回退（`/* → /index.html`），确保 vue-router 深链接可用。

### 部署到 InfinityFree（免费主机）

InfinityFree 有**硬性单文件上限**（HTML/PHP/JS 1MB、其他 10MB），超限文件会被**静默删除**。
原始 `dist/` 中 `ffmpeg-core.wasm`(32MB) 等 5 个文件会阵亡，必须用裁剪版：

```bash
pnpm build
pnpm prune:infinityfree        # 生成 dist-infinityfree/（自动剔除超限文件 + 专用 .htaccess）
```

把 `dist-infinityfree/` 内容上传到 `htdocs/`。剔除的 ffmpeg / tesseract 内核会由代码内置的
**CDN 兜底链路**自动接管（首次使用需联网，之后浏览器缓存复用），PDF worker 亦有同等兜底。

> ⚠️ InfinityFree 禁用了 `Header` / `Expires` 指令（写了会整站 502），因此**无法开启跨源隔离**，
> 多线程 ffmpeg 不可用，媒体转换自动降级为单线程。仅建议用于学习/演示，
> 正式发布请优先 Vercel / Netlify / Cloudflare Pages。

---

## 媒体内核策略（适配不同托管环境）

ffmpeg 内核按需加载，支持三种策略，通过 URL 参数或持久化配置切换：

| 策略 | 行为 | 适用场景 |
|---|---|---|
| `auto`（默认） | 本地MT → CDN-MT → 本地ST → CDN-ST | 常规部署，本地内核优先（省流量、离线可用） |
| `cdn` | **CDN-MT → 本地MT → CDN-ST → 本地ST** | **有单文件上限的免费主机**：不占主机空间，多线程照常可用 |
| `st` | 直接单线程 | 诊断 / 无 SharedArrayBuffer 环境 |

切换方式（二选一）：

```
https://你的域名/?lf-core=cdn        # 访问一次即写入 localStorage，之后一直生效
```

```js
localStorage.setItem('lf-core', 'cdn')   // 或在控制台设置
```

> **重要**：`cdn` 策略下**多线程不会退化**——`@ffmpeg/util` 的 `toBlobURL` 会把 CDN 资源
> 转成同源 blob，因此不违反 `COEP: require-corp`，跨源隔离照常生效。
> 代价是首次加载需联网拉取约 32MB 内核（之后由浏览器缓存复用）。

### 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/javaeer/local-forge)

导入仓库后，构建命令 `pnpm build`、输出目录 `dist` 即可（配置文件已包含）。
Netlify / Cloudflare Pages 直接连接仓库并选用 `pnpm build` + `dist` 同样开箱即用。

---

## 隐私与安全

- **关于 / 隐私协议页面**：站点提供独立的「关于」与「隐私协议」页面（页脚可达）。隐私协议已就第三方广告（Google AdSense 等）的数据收集、Cookie 与退出方式作出声明，为后续接入广告预留合规基础；实际接入广告前，页面不加载任何广告脚本、不收集数据。
- **零上传**：所有处理在浏览器内通过 WebAssembly 完成，没有任何文件离开你的设备。
- **公众号排版不联网**：Markdown 编译、多端渲染、模板应用、自定义主题导入导出、本地图片转 DataURL（含压缩/粘贴截图/SVG→PNG）、元数据校对、静态规范自检、离线发布包与批量 ZIP 全部在浏览器内完成；草稿与自定义主题只存本机 `localStorage`。不调用微信接口、不上传图片、不拉取 CDN。产物只写入剪贴板或下载为 HTML/ZIP，发布动作（粘贴到公众号后台）始终由你手动完成。
- **App 图标生成不联网**：Logo 解码、缩放、裁剪/留白、背景合成、PNG 编码与 ZIP 打包全部在浏览器内存中完成，零上传、不用 AI、不调用 Apple / Google 接口。产物只下载为 PNG / ZIP；按平台规范做尺寸、体积与 alpha 通道自检，但不生成 Adaptive Icon 分层或 Xcode / Android 资源工程。
- **零追踪**：无分析、无遥测、无第三方请求（除非回退到 jsDelivr 拉取 ffmpeg 内核）。
- **P2P 直传**：分享功能用 WebRTC 点对点传输，信令靠手动复制 SDP，不经中心服务器。
- 解析不可信归档/媒体仍有理论攻击面（zip bomb、路径穿越、内核解析漏洞），请勿用它处理来源不明的文件。
- 漏洞请按 [SECURITY.md](.github/SECURITY.md) 私密报告，**勿开公开 Issue**。

---

## 工程结构

```
src/lib/archive.js   通用归档引擎：extract / createZip / createArchive / convert / merge
src/lib/writers.js   可靠的 ZIP/TAR/TAR.GZ 写入器（USTAR，正确处理嵌套路径）
src/lib/media.js     ffmpeg 媒体转换封装（本地多线程优先，回退单线程 / CDN）
src/lib/pdf.js       PDF 重压缩
src/lib/formats.js   格式与压缩选项 + 完整工具目录
src/lib/wechat.js    公众号排版内核：AST / 样式映射 / 微信渲染 / code 化诊断（零依赖纯函数）
src/lib/wechat-extra.js  排版扩展层：多端输出 / 模板 / 主题 IO / 元数据 / 纯 JS ZIP 发布包
src/lib/wechat-search.js  公众号检索内核：文章/合集解析 / 翻页 / 过滤 / 原图改写 / 取数器（零依赖纯函数）
src/lib/app-icon.js  App 图标内核：19 尺寸预设 / 面积平均缩放 / 去 alpha 合成 / 纯 JS ZIP（零依赖纯函数）
src/views/           Home / ZipCompress / ZipExtract / ArchiveTool /
                     MediaConvert / ImageConvert / AppIcon / PdfTools / DocConvert /
                     WechatArticle / WechatSearch / ShareFiles / PasswordRecovery / Repair /
                     About / Privacy
src/components/      DropZone.vue 拖拽上传 / AdSlot.vue 广告位预留（接 AdSense 用）
tests/unit/wechat.test.mjs          公众号排版内核单测 16 项（Node 原生 test，无需浏览器）
tests/unit/wechat-extra.test.mjs    排版扩展层单测 25 项
tests/unit/app-icon.test.mjs        App 图标内核单测 19 项（含无 alpha 通道 / ZIP 结构）
_e2e_wechat.mjs                    公众号排版浏览器端 e2e（16 项断言）
_e2e_wechat_search.mjs             公众号检索浏览器端 e2e（17 项断言，零跨域请求）
scripts/wechat-search.mjs          公众号检索 CLI：合集翻页 / 关键词检索 / 导出（Node 无 CORS 限制）
_e2e_app_icon.mjs                  App 图标浏览器端 e2e（21 项断言，含下载 ZIP 字节解析）
docs/wechat-article-local-plan.md   纯本地化落地与完整实现记录
docs/wechat-search-local-plan.md   公众号检索落地记录（合集协议 / CORS 三条路 / 限速策略）
docs/app-icon-local-plan.md         App 图标生成器落地记录与平台规范对照
public/libarchive/   libarchive.js 的 worker 与 wasm（不被打包，置于 public）
public/ffmpeg/       ffmpeg 多线程内核（本地打包，离线可用）
public/ffmpeg-st/    ffmpeg 单线程内核（跨源隔离不可用时的回退）
```

---

## 发布流程

发布是显式动作，由打 `v*` tag 触发，不绑定日常 push：

1. **前置**：`main` 上的 CI（build / unit / e2e-core）必须全绿。**CI 红灯时不得发版。**
2. **打 tag**：维护者创建并推送语义化版本 tag，例如 `git tag v1.0.0 && git push origin v1.0.0`。
   - tag 受保护，仅维护者可创建；不能用 tag 绕过门禁。
3. **自动门禁**：`release.yml` 重跑一致性护栏、单测、构建、体积预算、core e2e，任一失败即中止，不产出 Release。
4. **产物**：自动打包 `dist` + 离线内核数据快照（ffmpeg / tesseract / libarchive / pdfjs / 词典 / 诗文 / 中医），附 `MANIFEST.json` 与逐文件 `SHA256SUMS.txt`，并生成 GitHub Release 与增量变更日志。
5. **校验**：下载 `local-forge-<version>.zip`，解压后进入包目录执行 `sha256sum -c SHA256SUMS.txt`（包内自带该清单）。

也可在 Actions 面板手动触发 Release（workflow_dispatch），用于补发或演练；演练时建议先把 Release 设为 draft。

> 本地想复现打包：`pnpm build && node scripts/pack-release.mjs`，产物在 `release/`。
> 首次发布前需由管理员在仓库 Settings 中开启 `v*` tag 保护规则（仅维护者可创建）。

---

## 路线图

- [x] ~~暗色 / 亮色主题切换~~（已上线，含侧栏/顶栏双布局）
- [x] ~~i18n（中英界面）~~（已扩展为中日英韩西五语）
- [x] ~~批量图片压缩队列与进度~~（已上线「批处理队列」，支持多种操作 + 预设）
- [x] ~~PWA 可安装 + 离线内核按需预缓存~~
- [x] ~~Markdown → PDF / HTML 文档转换~~
- [x] ~~Markdown → 微信公众号排版（纯本地内联 HTML + 富文本剪贴板）~~
- [x] ~~公众号排版扩展：三层解耦 + 5 端输出 + 模板/自定义主题 + 图片策略 + 元数据/报告 + 离线发布包/批量/草稿 + 5 语言诊断~~
- [x] ~~App 图标多尺寸生成（19 尺寸 / 无 alpha 通道 / 裁剪与背景 / ZIP / 5 语言 / 离线可用）~~
- [ ] 7Z / ISO 创建（待可行的开源 WASM 编码方案）
- [ ] 目录拖拽保留结构（webkitRelativePath）
- [ ] 接入 Google AdSense 等第三方广告（`AdSlot` 组件已预留，待申请广告账号后填充 `data-ad-client` / `data-ad-slot`）
- [ ] 更多媒体预设（GIF、HEVC、无损提取）
- [ ] 多端封装：Web-first + Capacitor（App）/ Tauri（桌面），复用同一套 WASM 引擎

欢迎通过 Issue / PR 参与，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 致谢

> **声明**：LocalForge 是一个独立的开源项目，与 LocalForge 无任何隶属、合作或背书关系；其名称仅在与「灵感来源」相关的语境下被引用。

- 灵感来自 [LocalForge](https://lf.yunlou.net.cn/)；- 核心引擎依赖 [@zip.js/zip.js](https://github.com/gildas-lormeau/zip.js)、[libarchive.js](https://github.com/libarchive/libarchive.js)、[@ffmpeg/ffmpeg (ffmpeg.wasm)](https://github.com/ffmpegwasm/ffmpeg.wasm)、[pdf-lib](https://github.com/Hopding/pdf-lib)；
- 图标来自 [Bootstrap Icons](https://icons.getbootstrap.com/)。

## 许可证

[MIT](LICENSE) © LocalForge Contributors
