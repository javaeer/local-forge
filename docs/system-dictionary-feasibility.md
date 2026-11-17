# 系统自带词典能否加载进 LocalForge？—— 可行性分析与替代路径

> 起因：设想「把 macOS / iPhone / Windows 系统自带的词典也装进来」。
> 结论先行：**iOS / Windows 不可行；macOS 有条件可行（仅限自带文件导入，不能打包分发）；
> 推荐"开源同款词库"路线（已实现 ECDICT，77 万条英汉双解）**。

## 一、逐平台判定

### iPhone / iOS —— ❌ 不可行
系统词典由 `UIReferenceLibraryViewController` 按需下载，存储在应用沙箱外的私有路径
（`/var/mobile/Library/Assets/dictionary_stores/`），格式专有且无公开解析接口。
浏览器页面（Safari / 任何 PWA）拿不到系统文件——这是 iOS 沙箱模型的硬边界，无路可走。

### Windows —— ❌ 不可行（无物可加载）
Windows 系统不内置"带释义的查词词典"，只有拼写检查词典（专有 `.lex` 二进制，
且只有词表没有释义）。没有可导入的内容。

### macOS —— ⚠️ 有条件可行
词典位于 `/Library/Dictionaries/*.dictionary/Contents/resources/Body.data`
（内容为牛津 North American English、现代汉语规范词典等**授权内容**）。
格式是 Apple 专有二进制，但已被开源社区逆向：

- [JadedTuna/apple-dictionary](https://github.com/JadedTuna/apple-dictionary)（MIT）：
  `dedict`（C）可解出完整 XML（NOAD 约 192MB）。

**为什么浏览器不能直接读**：沙箱页面无文件系统权限，`File System Access API`
虽可让用户手动选中 Body.data，但仍需在浏览器内重写整套专有格式解析器（中等偏大工程，
仅桌面 Chromium 支持）——评估后暂不实现，留作后续选项。

## 二、macOS 用户的两步导入配方（合规，仅自用）

1. 在 Mac 上解包（任选其一）：
   ```bash
   # 方式 A：开源工具（推荐）
   git clone https://github.com/JadedTuna/apple-dictionary && cd apple-dictionary && make
   ./dedict "/Library/Dictionaries/New Oxford American Dictionary.dictionary/Contents/resources/Body.data" | ./strip > dict.xml
   ```
   ```bash
   # 方式 B：Finder 里右键 .dictionary →「显示包内容」取出 Body.data，交给方式 A 处理
   ```
2. 把 XML/文本整理成 TSV（`词<TAB>音标<TAB>释义1|释义2`）后，
   在 LocalForge「离线词典 → 导入词库」拖入即可——管道（解析/索引/检索/IndexedDB 持久化）已就绪。

## 三、法律红线

Apple 内置词典是**出版级授权内容**（牛津等）：

- ✅ 自用提取：个人使用范畴，普遍可接受；
- ❌ 进 Git 打包分发：侵犯版权，**禁止**。LocalForge 的词库策略一直是
  「数据不入库、BYO 文件、来源可审计」，系统词典导入同样只走 BYO 模式。

## 四、推荐路线：开源同款词库（已落地）

如果目标是「系统级词典的查词体验」而非「字面上用系统文件」，开源数据可全平台复用且合规：

| 词库 | 许可 | 规模 | 说明 |
|---|---|---|---|
| **ECDICT**（[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)） | MIT | 约 77 万条 | 英汉+英英双解，含 IPA 音标、词频（BNC/COCA）、Oxford3000/Collins/考级标签。已在词典页「内置词库」切换装载，`dict-en` 内核组可预缓存 |
| CC-CEDICT | CC BY-SA 4.0 | 约 12 万条 | 汉英（默认主词库） |
| 新华字典类中文数据 | ⚠️ 版权存疑 | — | 《新华字典》正文释义为商务印书馆版权内容，开源仓库的数据属爬取所得，**不建议入库分发**；规范中文释义请走正版渠道 |

## 五、决策记录

- 2025-xx：评估「浏览器内直接解析 Body.data」（File System Access API + JS 版 dedict）→
  工程量大、平台覆盖窄（仅桌面 Chromium + 仅 macOS 用户有文件），暂缓；
- 采用 ECDICT 作为「英汉大词库」内置源，覆盖学习词典核心诉求（音标/词频/考级标签/双解）。
