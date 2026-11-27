# Third-Party Notices / 第三方许可证披露

LocalForge 及其 Pro 版本依赖以下开源项目。本文件依据各依赖实际发布版本（见 `package.json` 与 `pnpm-lock.yaml`）的许可证声明整理，随软件一同分发。

LocalForge 自身的源代码以 [MIT License](LICENSE) 发布；本文件仅覆盖第三方依赖，**不改变 LocalForge 自有代码的许可**。

---

## ⚠️ 需要特别注意：GPL-2.0-or-later 组件

以下两个依赖以 **GPL-2.0-or-later** 许可证发布，随软件的 WASM 内核一并分发：

| 依赖 | 版本 | 许可证 | 用途 | 源码获取 |
|---|---|---|---|---|
| `@ffmpeg/core` | 0.12.10 | GPL-2.0-or-later | 单线程音视频转码内核（`dist/ffmpeg/`） | https://github.com/ffmpegwasm/ffmpeg.wasm |
| `@ffmpeg/core-mt` | 0.12.10 | GPL-2.0-or-later | 多线程音视频转码内核（`dist/ffmpeg-st/`） | https://github.com/ffmpegwasm/ffmpeg.wasm |

- GPL-2.0 许可证全文：<https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt>
- ffmpeg.wasm 项目主页：<https://github.com/ffmpegwasm/ffmpeg.wasm>

**说明**：LocalForge / LocalForge Pro 的自有代码（包括但不限于任务队列、预设、授权模块）仅通过公开 API 调用上述组件，不对其进行修改，亦不构成其衍生作品；因此自有代码不受 GPL 传染，可按各自许可（含 Pro 版的闭源授权）分发。上述 GPL 组件本身仍受 GPL-2.0-or-later 约束，其源码依上述链接获取。

---

## 全部依赖清单

| 依赖 | 版本 | 许可证 | 项目主页 |
|---|---|---|---|
| `@ffmpeg/ffmpeg` | 0.12.15 | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| `@ffmpeg/util` | 0.12.2 | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| `@ffmpeg/core` | 0.12.10 | **GPL-2.0-or-later** | https://github.com/ffmpegwasm/ffmpeg.wasm |
| `@ffmpeg/core-mt` | 0.12.10 | **GPL-2.0-or-later** | https://github.com/ffmpegwasm/ffmpeg.wasm |
| `@zip.js/zip.js` | 2.15.0 | BSD-3-Clause | https://gildas-lormeau.github.io/zip.js |
| `bootstrap-icons` | 1.13.1 | MIT | https://icons.getbootstrap.com/ |
| `fflate` | 0.8.3 | MIT | — |
| `hash-wasm` | 4.12.0 | MIT | https://github.com/Daninet/hash-wasm |
| `libarchive.js` | 2.0.2 | MIT | https://github.com/nika-begiashvili/libarchivejs |
| `pdf-lib` | 1.17.1 | MIT | — |
| `pdfjs-dist` | 4.10.38 | Apache-2.0 | https://mozilla.github.io/pdf.js/ |
| `qrcode` | 1.5.4 | MIT | https://github.com/soldair/node-qrcode |
| `tesseract.js` | 7.0.0 | Apache-2.0 | https://github.com/naptha/tesseract.js |
| `tesseract.js-core` | 7.0.0 | Apache-2.0 | https://github.com/naptha/tesseract.js-core |
| `upng-js` | 2.1.0 | MIT | — |
| `vue` | 3.5.42 | MIT | https://vuejs.org/ |
| `vue-router` | 5.3.1 | MIT | https://router.vuejs.org/ |
| `zxing-wasm` | 3.1.5 | MIT | https://github.com/Sec-ant/zxing-wasm |

---

## 许可证全文链接

- **MIT**：<https://opensource.org/licenses/MIT>
- **BSD-3-Clause**：<https://opensource.org/licenses/BSD-3-Clause>
- **Apache-2.0**：<https://www.apache.org/licenses/LICENSE-2.0>
- **GPL-2.0-or-later**：<https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt>

如需任一依赖的完整许可证文本，请访问上表对应的项目主页或其发布包内的 `LICENSE` 文件。
