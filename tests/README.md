# 测试体系

LocalForge 的测试分两层，统一由 [`run.mjs`](./run.mjs) 入口驱动，CI（`.github/workflows/ci.yml`）据此运行。

## 1. 单元测试（`tests/unit/`）

零 DOM 依赖的纯逻辑，用 Node 内置 `node:test` 直接跑。覆盖：

| 文件 | 被测模块 | 重点 |
| --- | --- | --- |
| `text.test.mjs` | `src/lib/text.js` | base64/hex/json/uuid/sha/jwt/正则/密码强度 |
| `filetype.test.mjs` | `src/lib/filetype.js` | 扩展名归类、FILTER 元数据一致 |
| `formats.test.mjs` | `src/lib/formats.js` | 45 张卡片结构 + 首页 key 5 语言运行时存在 |
| `nav.test.mjs` | `src/lib/nav.js` | NAV 结构、path 唯一、分组声明、命令面板搜索 |
| `i18n.test.mjs` | `src/lib/i18n.js` + `i18n.dev.js` | 5 语言词条齐全、插值、缺失 key 安全回退 |
| `workflow.test.mjs` | `src/lib/workflow.js` | 工作流目标可达、WF_LABELS 5 语言齐全 |
| `fileio.test.mjs` | `src/lib/fileio.js` | 体积格式化、体积门禁 |
| `progress.test.mjs` | `src/lib/progress.js` | 加权进度、活动阶段推导 |

> 与 `scripts/check-consistency.mjs`（静态扫源码「是否声明 key」）互补：
> 单元测试运行时「是否真能取到」，两者结合杜绝 key 泄漏与缺语言。

## 2. 端到端测试（`_e2e_*.mjs`）

真实浏览器（puppeteer-core + Chromium）验证。脚本保留历史命名，散在仓库根；
**统一约定由 `run.mjs` 注入**，脚本内部不必关心：

- 环境变量：`BASE` / `BASE_URL`（runner 统一指向实际服务地址）
- 浏览器路径：`CHROME_PATH` / `CHROMIUM_PATH`（runner 探测并注入，CI 上自动 `npx puppeteer browsers install chrome`）
- 服务：runner 按需起 `vite preview`(4173) 或 `vite dev`(5173)，跑完回收

### 套件分组（见 [`suites.mjs`](./suites.mjs)）

- **core**：快、稳，CI 默认跑（i18n / layout / features / qrcode / progress / doc / batch / imagepro / offline）
- **heavy**：慢或需特殊内核（全引擎自检 / OCR / 大文件 / ffmpeg 多线程 / 图片内核），本地或夜跑

## 运行方式

```bash
pnpm test                 # 单元测试 + core 组 e2e
pnpm test:unit            # 只跑单元测试
pnpm test:e2e             # 只跑 e2e core 组
pnpm test:e2e:heavy       # 跑 heavy 组
pnpm test:e2e:i18n        # 只跑某个套件
node tests/run.mjs e2e --only i18n,doc --verbose
node tests/run.mjs e2e --skip ocr
node tests/run.mjs --list
```

> 运行 e2e 前若 `dist/` 缺失，runner 会自动 `vite build` 一次。
> 需要 Chromium 时设置 `CHROME_PATH`，或 `npx puppeteer browsers install chrome`。
