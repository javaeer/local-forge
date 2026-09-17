# LocalForge，中文名“本地工坊”。

## Slogan：Your files never leave your browser.

[本地工坊](https://lf.yunlou.net.cn/) 的**纯浏览器端**文件处理能力。**所有压缩 / 解压 / 转换 / 分享都在用户浏览器本地完成，文件不上传任何服务器。**

## 技术栈

| 能力 | 实现 | 说明 |
|---|---|---|
| 前端框架 | Vue 3 + Vite + vue-router | 
| ZIP 压缩 / 解压 | **@zip.js/zip.js 2.15**（Web Worker 多线程 + AES-256 加密 + 分卷） 
| 多格式解压 | **libarchive.js 2.0**（libarchive 的 WASM 移植） 
| 媒体转换 | **@ffmpeg/ffmpeg 0.12 多线程内核**（SharedArrayBuffer） 
| 图片处理 | Canvas API | PNG/JPG/WEBP 互转与压缩、本地预览 |
| PDF 处理 | pdf-lib | 重压缩内嵌图像、对象流去重 |
| P2P 分享 | WebRTC（手动 SDP 信令，无后端） | 点对点直传，文件不经服务器 |
| 跨源隔离 | `COOP: same-origin` + `COEP: require-corp` | 真正启用，使多线程 WASM 生效 |

## 功能目录（全量复刻）

- **ZIP 工具箱**：压缩为 ZIP（含 AES-256 密码、分卷拆分、压缩级别）／解压 ZIP（支持加密）／合并归档／格式互转
- **创建归档**：ZIP / TAR / TAR.GZ（自研可靠写入器）
- **解压 / 提取**：RAR / 7Z / TAR / ISO / APK / DMG / WIM / DNG 等 200+ 格式（libarchive.js）
- **媒体转换**：MP4↔WebM↔MOV、MP4→MP3、WAV↔MP3、降码率压缩；支持从 ZIP 内提取媒体
- **图片**：PNG / JPG / WEBP 互转、有损压缩、本地预览（HEIC/AVIF 依赖浏览器解码）
- **文档 / PDF**：PDF 重压缩
- **分享 / 安全**：WebRTC P2P 直传、ZIP 密码字典恢复（AES）、归档修复

> **关于 7Z / ISO / XZ / ZST / BZ2 的「创建」**：这些格式需要原版专有的 WASM 编码模块（网页端不可得），本项目**不伪造**其创建能力——`createArchive` 对不支持的格式会明确报错并建议使用 ZIP / TAR / TAR.GZ。
> 但其**解压 / 提取**由 libarchive.js 完整覆盖，可放心使用。

## 运行

```bash
pnpm install
pnpm dev        # 开发，http://localhost:5173
pnpm build      # 生产构建
pnpm preview    # 预览构建产物，http://localhost:4173
```

> 媒体转换依赖 ffmpeg 多线程内核，需要跨源隔离头（已在 `vite.config.js` 的
> `server.headers` / `preview.headers` 中配置）。内核默认放在 `public/ffmpeg/`（本地打包），
> 首次 `pnpm dev` / `pnpm preview` 即可离线使用；若缺失会自动回退到 jsDelivr CDN。

## 本地测试样本（已生成于仓库外 `samples/`）

由本工程 zip.js 引擎生成，可直接下载验证解压 / 加密：

| 文件 | 说明 | 验证方式 |
|---|---|---|
| `sample-no-password.zip` | 含 `docs/` 嵌套目录的文本文件，无密码 | 任意解压工具（含系统 `unzip`）均可解 |
| `sample-with-password.zip` | 同上内容，**AES-256 加密**，密码 **`ezyzip`** | 7-Zip / WinZip / macOS / Windows 资源管理器 / 本网页端「解压 ZIP」输入密码 |
| `sample-binary.zip` | 含随机二进制附件，验证二进制完整性 | 解压后比对校验和 |
| `sample.tar` | 含 `nested/` 嵌套条目的 tar 归档 | `tar -tf sample.tar` 或本网页端「多格式解压」 |

> 已实测：无密码 zip 系统 `unzip` 正常解压且嵌套目录保留；tar 系统 `tar` 正常列出嵌套条目；
> AES zip 在本网页端（zip.js）用密码 `ezyzip` 可正确解密还原嵌套条目。
> zip.js 输出的是 **WinZip AES（compress_type=99）**，即 7-Zip / WinZip / macOS / Windows 通用标准；
> 个别 Python 库（如 pyzipper 某些版本）读取 zip.js 输出的 AES 存在已知误判，不影响真实用户工具。

### 快捷本地验证（无需运行工程）

```bash
unzip sample-no-password.zip -d out1                 # 无密码
tar -tf sample.tar                                   # tar 嵌套条目
# AES zip 用 7-Zip / WinZip / macOS / Windows 资源管理器打开，密码 ezyzip
```

## 工程结构

```
src/lib/archive.js   通用归档引擎：extract / createZip / createArchive / convert / merge
src/lib/writers.js   可靠的 ZIP/TAR/TAR.GZ 写入器（USTAR，正确处理嵌套路径）
src/lib/media.js     ffmpeg 媒体转换封装（本地内核优先，CDN 回退）
src/lib/pdf.js       PDF 重压缩
src/lib/formats.js   格式与压缩选项 + 完整工具目录
src/views/           Home / ZipCompress / ZipExtract / ArchiveTool /
                     MediaConvert / ImageConvert / PdfTools /
                     ShareFiles / PasswordRecovery / Repair
src/components/      DropZone.vue 拖拽上传
public/libarchive/   libarchive.js 的 worker 与 wasm（不被打包，置于 public）
public/ffmpeg/       ffmpeg 多线程内核（本地打包，离线可用）
```

## 端到端验证

`node _e2e.mjs`（puppeteer + 真实 Chromium）覆盖：ZIP/TAR/TAR.GZ 创建（含嵌套路径）、
AES 密码加解密回环、格式转换、多归档合并、不支持格式报错、归档修复、嵌套 tar 提取——
全部通过且控制台零运行时错误。
