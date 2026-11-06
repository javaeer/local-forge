# App 图标生成器 · 纯本地落地记录

> 能力来源：DevCove《App 图标多尺寸生成器》的功能规格（<https://devcove.dev/zh/tools/app-icon-generator/>），
> 尺寸与格式依据 Apple HIG / App Store Connect Help 与 Google Play / Android 官方规范。
> 只复用「功能规格 + 公开规范事实」，未复制该站点的文案、视觉或代码。
> 相关分析：`/workspace/App图标生成器_集成可行性分析.md`

---

## 1. 结论先行

**已集成，定位为「复用 LocalForge 图片内核 + 新增薄尺寸层 + 一个 Vue 页面」**，不是移植第三方站点。

- 新增路由 `/app-icon`，归入「图片」分组；首页第 47 张卡片。
- **零新增 npm 依赖、零 WASM 内核、零网络请求、零上传、不用 AI**。
- 产物是**命名清晰的扁平 PNG 包**，不是 Xcode Asset Catalog / Android 资源工程。
- 增量价值相对云端工具：**离线可用 + 开源可审计 + Logo 不出本机**。

---

## 2. 为什么不能直接复用 `resizeImage()`

| 约束 | `image.js` 现状 | 本工具做法 |
| --- | --- | --- |
| App Store 1024 禁止 alpha 通道（ITMS-90717） | `canvasEncode(img,'image/png')` 输出 RGBA，即使全不透明也可能带 alpha 通道 | 先 `flattenRgba()` 合成到实色背景，再用 **`UPNG.encode(..., forbidPlte=true)`** 输出 **colorType=2（RGB）** |
| 一次解码 N 次缩放 | 每次 `resizeImage(file)` 内部都会重新 `decodeToImageData(file)` | 视图只解码一次得到 `ImageData`，内核 `renderIconSet()` 循环复用 |
| 背景色可配置 | 硬编码 `#ffffff`，且只在 `pad` / JPEG 分支铺底 | `normalizeBackground()` 白名单 + `scaleRgba()` 统一按 `source-over` 合成 |
| Node 可单测 | 依赖 `document.createElement('canvas')` | 缩放用纯 JS **面积平均（box filter）**，`app-icon.js` 全链路无 DOM |
| 尺寸精确 / 机器校验 | `Math.round` 可能产生非预期值 | 每个产物断言 `width === height === preset.size` |
| Google Play 512 ≤ 1024 KB | 无 | `maxBytes` 门禁 + `icon-too-large` 诊断 |

> 关键实测：`UPNG.encode([rgba], w, h, 0, 0, true)` 在**全不透明**数据下输出 `colorType=2`（无 alpha 通道），
> 含半透明时输出 `colorType=6`。这把「上架合规」从「 hope 浏览器编码器不写 alpha」变成确定性行为，
> 且 `upng-js` 是纯 JS，可在 Node 单测里直接读 PNG 第 25 字节断言。

---

## 3. 尺寸预设表（19 项）

| 组 | 尺寸(px) | 文件名 | alpha | 默认 | 说明 |
| --- | --- | --- | --- | --- | --- |
| store | 1024 | `Icon-1024.png` | **禁止** | ✅ 必选 | App Store Connect 唯一硬性图标，不透明、方形、无圆角 |
| store | 512 | `Icon-512.png` | 允许 | ✅ | Google Play 32-bit PNG，≤ 1024 KB，完整方形 |
| ios | 180/167/152/120/87/80/76/60/58/40/29/20 | `Icon-{n}.png` | 禁止 | ❌ | Xcode 14+ 只需 1024 派生，兼容旧 deployment target |
| android | 48/72/96/144/192 | `ic_launcher-{density}.png` | 禁止 | ✅ | 48dp 在 mdpi→xxxhdpi 的像素等价 |

`required` 项（App Store 1024）不可取消，保证执行计划永不为空。文件名纯 ASCII，避免旧解压工具 mojibake。

---

## 4. 平台规范对照（本工具实际守住的硬约束）

| 平台 | 规则 | 实现位置 |
| --- | --- | --- |
| App Store | 恰好 1024×1024、正方形 | `checkIconOutput()` |
| App Store | **无 alpha 通道**、完全不透明 | `flattenRgba()` + `UPNG.encode(forbidPlte=true)` + `checkIconOutput()` |
| App Store | 不预加圆角 / 阴影 | 只做裁剪与缩放，不绘制 mask |
| App Store / Play | PNG、sRGB、8bit | UPNG 输出；Canvas 解码天然归一化到 sRGB |
| Google Play | 512×512、32-bit PNG、≤ 1024 KB | `maxBytes` 门禁 |
| Google Play | 完整方形，由 Play 自动加圆角 | `scaleRgba('cover')` 铺满，不裁圆 |
| Android | launcher 图标与商店图标是不同资产 | README 明确声明，只输出传统密度 PNG |

---

## 5. 内核 API（`src/lib/app-icon.js`）

纯数据层
: `ICON_GROUPS`、`ICON_PRESETS`、`DEFAULT_PRESET_IDS`、`getPreset()`、`resolvePresets()`、`iconFileName()`

规划层
: `normalizeBackground(input)` → `{ hex, rgb, issues }`；`planIconSet({ presetIds, fit, background })` → `{ presets, fit, background, issues }`

像素层
: `flattenRgba(imageData, bg)`、`scaleRgba(src, size, fit, bg, { flatten })`（面积平均 + source-over 合成）

编码与校验
: `encodeIconPng(rgba)`、`pngColorType(bytes)`、`checkIconOutput(preset, bytes, w, h)`

批量与打包
: `renderIconSet(imageData, presets, opts)`、`buildIconZip(entries)`（复用 `wechat-extra.js` 的 `buildStoreZip()`）

诊断 code：`bg-invalid` / `fit-invalid` / `no-preset` / `icon-size-mismatch` / `icon-alpha-channel` / `icon-too-large`，
在视图里映射为 5 语言文案（与公众号排版的 code 化诊断同一模式）。

---

## 6. 缩放与合成算法

```
scale = fit==='contain' ? min(size/sw, size/sh) : max(size/sw, size/sh)
offX  = (size - sw*scale)/2 ; offY = (size - sh*scale)/2
对每个目标像素 (dx,dy)：
  反投影到源区域 [sx0,sx1) × [sy0,sy1)
  对覆盖的源像素按重叠面积加权，累加「预乘颜色」与 alpha
  flatten=true : out = C_premul_avg + bg*(1-α_avg)  且 a=255   // source-over，天然不透明
  flatten=false: out = C_premul_avg/α_avg, a = α_avg*255        // Google Play 保留 alpha
  区域无覆盖（contain 留白）: out = bg, a=255
```

面积平均（box filter）在 1024→20 这类大比例缩小时比最近邻/双线性更能抑制混叠；放大时退化为最近邻，
并已在 UI 中对 <1024 源图给出「放大无法恢复细节」提示。

---

## 7. 集成清单

| 文件 | 改动 |
| --- | --- |
| `src/lib/app-icon.js` | 新增零依赖纯内核（约 300 行） |
| `src/views/AppIcon.vue` | 新增视图：拖放/粘贴、裁剪二选一、背景色、19 预设分组勾选、实时预览、单文件/ZIP 下载、5 语言、NextSteps |
| `src/lib/nav.js` | 新增 `/app-icon` 导航项；**顺手修正 `/doc-convert` 误归「校验 / 隐私」→「开发者工具」** |
| `src/router/index.js` | 懒加载 `AppIcon` + `fileToPath` |
| `src/lib/formats.js` | 首页第 47 张卡片 |
| `src/components/SelfTestPanel.vue` | `VIEW_ROUTES` 覆盖新视图 |
| `src/lib/i18n.js` | 5 语言 `nav.appIcon` / `appIconShort` |
| `src/lib/i18n.home.*.js` | 5 语言 `home.t.appIcon` / `home.d.appIcon` |
| `src/lib/i18n.views.js` | 5 语言 `views.appIcon.*` 各 54 个 key |
| `src/lib/workflow.js` | `/image-convert`、`/svg-tool` → `/app-icon`；`/app-icon` → ZIP / 图片工具；新增 `wf.toAppIcon` 5 语言 |
| `public/sw.js` | `OFFLINE_NATIVE_TOOLS` 增加 `/app-icon` |
| `tests/unit/app-icon.test.mjs` | 新增 19 项单测 |
| `tests/unit/formats.test.mjs` | 卡片数 46 → 47 |
| `_e2e_app_icon.mjs` | 新增 21 项 e2e（含下载 ZIP 后解析字节） |
| `tests/suites.mjs` / `package.json` | 新增 `appicon` core 套件与 `test:e2e:appicon` 脚本 |
| `README.md` / `tests/README.md` | 功能矩阵、隐私、工程结构、路线图、测试清单 |

---

## 8. 验证矩阵

| 项 | 结果 |
| --- | --- |
| 一致性护栏 `check-consistency.mjs` | **8/8** |
| 单元测试 `node tests/run.mjs unit` | **102/102**（原 83 + 新增 19） |
| `pnpm build` | ✓ `AppIcon` 懒加载 chunk 14.04 kB / gzip 5.48 kB |
| 体积门禁 `check-bundle-size.mjs` | ✓ 全部预算达标 |
| appicon e2e | **21/21**，含「下载包内 `Icon-1024.png` 实测 1024×1024 且 colorType=2」 |
| i18n / layout / wechat e2e 回归 | 4/4 套件全部通过 |
| 系统 `unzip -t` 交叉验证 | `No errors detected` |

---

## 9. 明确不做（刻意收窄的边界）

- ❌ Adaptive Icon 分层（108dp 前景/背景、66dp 安全区、monochrome 层）——单张扁平图缩放会误导。
- ❌ Xcode `AppIcon.appiconset/Contents.json`、Android `res/mipmap-*` 工程结构、`ic_launcher.xml`。
- ❌ 216 / 108 / 432 等 adaptive 层像素尺寸。
- ❌ Favicon / PWA manifest / HTML `<link>` / maskable 图标——那是「网站图标」独立工作流。
- ❌ AI 生成图案、圆角/阴影预置 mask、截屏素材、商店提交 API。
- ❌ 任何联网、上传、第三方请求、新增 npm 依赖或 WASM 内核。

ZIP 内 `README.txt` 已用英文显式声明上述边界，避免用户把包误当作可直接导入 Xcode / Android Studio 的资源工程。

---

## 10. 已知限制

- `decodeToImageData()` 基于 `<img>` 解码：**GIF 只取首帧**，BMP 依赖浏览器，HEIC 会抛错并给出错误提示。
- 源图小于 1024×1024 时仅做放大，无法恢复细节；UI 会提示但不阻止。
- 缩放是纯 JS 面积平均，未使用 Canvas 的 `imageSmoothingQuality='high'`；这是为了让「无 alpha 通道 + Node 单测」成为确定性行为而做的取舍。
- `qrcode` / `progress` 两个 core 套件在沙箱环境下为**既有失败**（与本次改动无关，干净 HEAD 对照同样失败）。
