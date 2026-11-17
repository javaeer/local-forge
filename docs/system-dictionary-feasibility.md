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

## 六、ECDICT 实测数据（77 万条全量）

沙箱内对全量 `ecdict.csv`（66.0 MB / 770,611 条）实测，用于确定默认策略与界面提示：

| 指标 | 实测值 | 说明 |
|---|---|---|
| 源文件 | 66.0 MB | 773 行/秒级别的纯 CSV |
| gzip -9 快照 | 21.7 MB | 落 `public/dict/ecdict.csv.gz`，不入 Git |
| 解析 `parseEcdict` | 1.3–1.7 s | 逐字符状态机（字段内嵌引号与逗号） |
| 建索引 `buildIndex` | 1.3 s（护栏开）/ 2.7 s（含中文义项全量索引） | 后者让中文反查从"扫全表"变成倒排命中 |
| 常驻堆内存 | 约 500 MB | 77 万条 × (对象 + 释义数组 + 字符串) |
| 精确/前缀检索 | 0–1 ms | 二分 + Map |
| 中文释义反查 | 0–1 ms | 倒排召回 73.7 万个义项键 |

由此确定三条工程约束：

1. **不进首装路径**：`predev`/`prebuild` 钩子用 `--skip ecdict`，只有 `pnpm dict:fetch:all` 才拉 66 MB；
2. **单独内核组**：`dict-en` 与默认 `dict` 组分离，用户按需预缓存（21.7 MB）；
3. **界面明示代价**：词典页切到 ECDICT 时提示"首载 21.7 MB / 建索引约 4 秒 / 内存约 500 MB，移动端建议留在汉英词库"。

### 两个数据坑（已在解析器内处理）

- **字段内行分隔是字面 `\n`（反斜杠 + n）**，不是真换行。按真换行拆会得到一条超长释义，
  且界面把 `\n` 当普通字符显示；现按 `/\r?\n|\\n/` 双兼容拆分。
- **释义带词性前缀**（`n. 自行车` / `【化】丙酮`）。不剥离则「自行车」对「n. 自行车」只能算
  "包含"（30 分），会被 `bike-lane` 之类同分反超；现已在建索引与打分两处统一剥离，
  「自行车」恢复"精确"档（45 分）。同分时再按 BNC/COCA 词频排序，
  因此「自行车」的次序是 bike(2163) → cycle(2220) → bicycle(4366)，符合真实语料频率。
