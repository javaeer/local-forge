# 贡献指南 (Contributing)

感谢你考虑为 **LocalForge** 做出贡献！这是一个纯前端、零后端的本地文件工具箱，所有处理都在浏览器内完成。

## 行为准则

参与本仓库即表示你同意遵守 [行为准则](./CODE_OF_CONDUCT.md)。

## 开发环境

```bash
# 需要 Node.js 18+ 与 pnpm
corepack enable            # 启用 pnpm（如未安装）
pnpm install
pnpm dev                   # 开发服务器 http://localhost:5173
pnpm build                 # 生产构建到 dist/
pnpm preview               # 预览构建产物
pnpm test:e2e             # 端到端回归（需本机 Chromium，见下方“测试”）
```

> 媒体转换（ffmpeg 多线程内核）依赖跨源隔离头 `COOP/COEP`，开发服务器已在
> `vite.config.js` 中配置；生产部署见 README 的「部署」一节。

## 项目结构

```
src/lib/        引擎层（与 UI 解耦，可独立测试）
  archive.js     通用归档：extract / createZip / createArchive / convert / merge
  writers.js     ZIP/TAR/TAR.GZ 可靠写入器（USTAR，正确处理嵌套路径）
  media.js       ffmpeg 媒体转换封装（多线程优先 → 单线程回退 → CDN）
  pdf.js         PDF 重压缩
  formats.js     格式与压缩选项 + 完整工具目录
src/views/      每个功能一个页面（Vue SFC）
src/components/  DropZone.vue 拖拽上传等公共组件
public/         ffmpeg / ffmpeg-st / libarchive 的 wasm 与 worker（不被打包）
```

## 如何新增一个工具

1. 在 `src/lib/` 下实现引擎函数（尽量纯函数、可被 `_e2e` 直接调用）。
2. 在 `src/views/` 新增一个 `XxxTool.vue` 页面。
3. 在 `src/router/index.js` 注册路由，并补充 `meta.title`。
4. 在 `src/lib/formats.js` 的工具目录里登记，使其出现在首页卡片。
5. 如涉及新的二进制内核/wasm，放入 `public/` 并确认部署平台的文件大小限制。
6. 补充端到端用例到 `_e2e.mjs`（或新建 `_e2e_xxx.mjs`）。

## 提交约定

请使用 [Conventional Commits](https://www.conventionalcommits.org/) 风格：

```
feat: 新增 WebP 批量压缩
fix: 修复 AES 错密码未正确拒绝
docs: 补充部署章节
test: 增加 tar 嵌套提取用例
```

## 测试

端到端测试用 `puppeteer-core` + 本机 Chromium 驱动真实浏览器：

```bash
CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e          # 默认 http://localhost:5173
BASE_URL=http://localhost:4173 CHROMIUM_PATH=... pnpm test:e2e   # 针对预览构建
```

## Pull Request 流程

1. Fork 并新建分支（`feat/xxx`、`fix/xxx`）。
2. 确保 `pnpm build` 通过、必要的端到端用例通过。
3. 提交 PR，描述动机与改动点，关联相关 Issue。
4. 维护者评审通过后合并到 `main`。

如有大的方向性改动，建议先开一个 `feature_request` Issue 讨论。
