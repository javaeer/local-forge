# 公众号文章检索 · 落地与实现记录

> 记录把「在 LocalForge 里检索某个公众号发过的文章」落成工具页 + CLI 时的边界、取舍与验证结果。
> 目标读者：项目维护者与后续贡献者。
>
> **状态：已落地**。内核 `src/lib/wechat-search.js`（零依赖纯函数）、视图 `src/views/WechatSearch.vue`、
> CLI `scripts/wechat-search.mjs`；单测 29 项 + 浏览器 e2e 17 项 + 一致性护栏 8/8。

---

## 0. 结论先行

公众号**没有**公开的文章搜索 / 列表接口。能稳定枚举一个账号全部文章的唯一入口是
**合集（album，即文章顶部的话题标签）**：

```
文章页 HTML ──( album_id + __biz )──▶ 合集分页接口 ──▶ 标题/时间/链接 全量列表 ──▶ 本地关键词过滤
```

因此本工具不是「微信搜索的网页壳」，而是一条**确定性的数据链路**：

1. 给一篇已知文章 → 解析出它所属合集（`album_id` + `__biz`）；
2. 翻页拉整本合集（`continue_flag` 驱动，`begin_msgid/begin_itemidx` 游标翻页）；
3. 标题做本地检索：空格 = AND，`-词` = 排除（例：`六年级 冀教版 -测试卷`）；
4. 版本 / 年级 / 学科自动归类（人教版、北师大版、苏教版、冀教版…），一键按版本筛选；
5. 正文图片链接改写为 `/0` 原图直链（配合排版工具的图片本地化）；
6. 导出 CSV / Markdown / JSON。

**它能回答的问题**："这个号到底发没发过冀教版六年级的知识点？"——59 篇合集 30 秒翻完，0 命中就是 0 命中，
不用再翻聊天记录。

---

## 1. 边界：三条硬约束与对应设计

### 1.1 微信没有搜索 API

不伪造能力：不做"全网公众号搜索"，只做「一个账号 × 它的合集」的确定性检索。
合集是官方数据结构（文章页内嵌 `appmsgalbuminfo`），比爬历史消息页稳定得多。

### 1.2 mp.weixin.qq.com 不下发 CORS 头（浏览器直连必败）

这是本功能与 LocalForge「零联网」隐私模型冲突最大的地方，处理方式是**不粉饰、给退路**：

| 模式 | 行为 | 适用 |
|---|---|---|
| `direct` | 浏览器直连 → 必被 CORS 拦；**报错文案明说原因与出路** | Node CLI / 自建同域反代 |
| `proxy` | 用户自填代理前缀，支持 `{url}` 占位符；URL 由用户信任的服务转发 | 有自建反代的用户 |
| `paste` | 完全不联网：粘贴文章页 HTML / 合集 JSON，内核纯本地解析 | 隐私敏感场景，e2e 即用它 |

错误分类（`explainFetchError`）区分 `cors` / `http` / `network` / `blocked` / `paste-required`，
每种都给出可操作的一句话，不甩"请求失败"四个字。

### 1.3 微信有频率限制

实测高频翻页会返回空列表。`fetchAlbum` 翻页间隔默认 **1200ms**（可传 `delay` 覆盖，单测传 0），
并在 `truncated` 标志里如实报告"没翻完"，绝不假装拉全了。

### 1.4 反爬验证页（缺 chksm / 请求过快）

文章长链缺 `chksm` 参数或请求过快时，微信返回"环境异常"验证页（固定约 1969 字、无标题）。
`parseArticleHtml` 输出 `blocked: true`，`resolveFromArticle` 抛 `code='blocked'` 并提示
"用完整分享链接重试（含 chksm）或稍后再试"。

---

## 2. 架构：解析与取数彻底分离

```
┌─ 纯函数内核（零依赖，Node 可单测，浏览器/CLI 复用）──────────────┐
│  normalizeUrl / parseArticleRef      URL 归一化与识别            │
│  parseArticleHtml                    标题/公众号/时间/合集/图片   │
│  parseAlbumPayload(JSON|HTML)        合集两种响应形态统一归一化    │
│  filterArticles / sortArticles /     本地检索与归类               │
│  dedupeArticles / summarize          （版本/年级/学科词典匹配）    │
│  toCsv / toMarkdown                  导出（CSV 带 BOM）           │
│  toOriginalImageUrl                  /640 → /0 原图改写           │
└──────────────────────────────────────────────────────────────┘
            ▲ 解析层只吃字符串，永远不发请求
            │
┌─ 取数层（唯一发请求的地方）────────────────────────────────────┐
│  createFetcher({mode,proxy}) → getText(url)                  │
│  fetchAlbum()      翻页编排：游标 / 限速 / 去重 / truncated    │
│  resolveFromArticle()  文章 → biz + albumId                   │
└──────────────────────────────────────────────────────────────┘
            ▲
   ┌────────┴─────────┬──────────────────┐
   │ 浏览器视图        │ Node CLI          │
   │ WechatSearch.vue │ scripts/…mjs      │
   │ (direct/proxy/   │ (原生 fetch +     │
   │  paste 三模式)    │  微信 UA，无CORS) │
   └──────────────────┴──────────────────┘
```

### 2.1 解析层的三个细节（都是真页面里踩出来的）

- **文章页字段**是模板化的 JS 变量：`msg_title`（尾部可能带 `.html(false)` 要剥掉）、
  `nickname = htmlDecode("…")`、`ct`（秒级时间戳）、`biz/mid/idx`；合集信息藏在
  `appmsgalbuminfo: { album_id: '…', title: '…' }`，用「album_id 后 400 字符窗口 + 遇下一个
  album_id 截断」防止 title 串到别的对象。
- **合集分页接口返回 JSON**（`getalbum_resp.article_list`，游标字段 `msgid/itemidx` 直接可用），
  但 **合集页 HTML** 里是 JS 字面量 `articleList: [...]`（单引号 + `&amp;` 实体）。
  `parseAlbumPayload` 两种都吃；合集名只认「`title` 紧跟 `msg_title`」那一处，避免误抓文章条目的 title。
- **图片**：`data-src`（懒加载真实地址）优先于 `src`，去重、只留 `mmbiz.qpic.cn`、`&amp;` 还原；
  `toOriginalImageUrl` 把路径末段尺寸换成 `/0`。**水印去不掉**——作者合成进像素的水印任何
  下载方式都带着，界面文案如实说明。

### 2.2 归类词典

`EDITIONS / GRADES / SUBJECTS` 三张有序词典做**长词优先**匹配（`人教PEP版` 必须排在
`人教版` 前），命中即停；未命中归入「其他」。顺序即优先级，改词典不用动代码。

---

## 3. 能力矩阵

| 能力 | 网页端 | CLI |
|---|---|---|
| 文章 → 合集反查 | ✅ | ✅ |
| 合集整本翻页（去重 + 限速 + truncated 标志） | ✅ | ✅ |
| 关键词过滤（AND / 排除 / 版本 chips 一键填入） | ✅ | ✅ `--grep` |
| 版本 / 年级 / 学科自动归类与统计 | ✅ | ✅ |
| 正文图片 `/0` 原图直链 | ✅（列表 + 复制） | ✅ `--images` |
| 导出 CSV / Markdown / JSON | ✅ 下载 | ✅ `--csv/--md/--json` |
| 粘贴源码离线解析 | ✅ | —（Node 本身可联网） |
| 反爬页 / 失效链接的明确报错 | ✅ | ✅ |

---

## 4. 验证结果（全部可复跑）

| 检查 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `node --test tests/unit/wechat-search.test.mjs` | **29/29** |
| 全量单测 | `pnpm test:unit` | 131/131（含新增 29） |
| 一致性护栏 | `node scripts/check-consistency.mjs` | **8/8** |
| 包体积预算 | `node scripts/check-bundle-size.mjs` | 达标（新视图 chunk 23.8 kB，懒加载） |
| 构建 | `npx vite build` | 通过 |
| 浏览器 e2e | `node ./_e2e_wechat_search.mjs`（preview 4173） | **17/17** |
| CLI 实测 | `node scripts/wechat-search.mjs <文章> --grep "六年级 冀教"` | 三年级合集 66 篇翻完，冀教版 0 命中（结论与人工核对一致） |

e2e 的关键断言是**隐私不变量**：粘贴模式跑完全部解析与交互，全程**零跨域网络请求**。

---

## 5. 已知边界与不做的事

- **不做全网搜索**：只检索「给定的那个账号」。想换账号，换一篇文章链接即可。
- **合集之外的"往期推荐"**：部分账号不把旧文归入合集，本工具拿不到（合集是唯一稳定入口）。
- **不代下载图片**：只整理 `/0` 直链（复制 / 打开），下载动作留给用户，避免变成批量抓取器。
- **不破解验证码**：触发微信风控时如实报错并建议稍后再试，不做任何绕过。
- **频率自担**：CLI 已内置 1.2s 翻页间隔与 `--quiet`；请勿把它当压测工具。
