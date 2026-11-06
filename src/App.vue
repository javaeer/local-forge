<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { NAV, NAV_GROUPS, TAB_ITEMS, navTitle, navShort, groupLabel } from './lib/nav.js'
import { currentTheme, toggleTheme, currentLayout, setLayout } from './lib/theme.js'
import { recordUsage } from './lib/history.js'
import { setDownloadHook } from './utils.js'
import { typeOfName } from './lib/filetype.js'
import { locale, t, setLocale, initLocale, availableLocales, LOCALE_NAMES, LOCALE_SHORT } from './lib/i18n.js'
import CommandPalette from './components/CommandPalette.vue'
import ToastHost from './components/ToastHost.vue'

// 挂载前同步 <html lang>（i18n 已按 localStorage/系统语言初始化）
initLocale()

const route = useRoute()
const layout = ref(currentLayout())      // 'topbar'（默认）| 'sidebar'
const sidebarOpen = ref(false)           // 移动端抽屉
const sidebarCollapsed = ref(true)       // 桌面侧栏：图标窄栏（默认收起，点击展开）
const paletteOpen = ref(false)
const theme = ref(currentTheme())
const sbCloseEl = ref(null)

function closeSidebar() { sidebarOpen.value = false }
function openPalette() { paletteOpen.value = true }
function onToggleTheme() { theme.value = toggleTheme() }
const langOpen = ref(false)
function pickLocale(l) { setLocale(l); langOpen.value = false }
function toggleLangMenu() { langOpen.value = !langOpen.value }
function toggleCollapsed() { sidebarCollapsed.value = !sidebarCollapsed.value }
// 汉堡按钮三态：顶栏布局（没有侧栏）→ 打开「全部工具」；移动端侧栏布局 → 打开抽屉；桌面侧栏 → 切换窄栏。
// 修复：原实现把 v-if / v-else 两支的处理函数写反了，两种桌面布局下该按钮都是「点了没反应」的死按钮。
function onNavToggle() {
  if (!isSidebar.value) { paletteOpen.value = true; return }
  if (window.matchMedia('(max-width: 960px)').matches) { sidebarOpen.value = true; return }
  toggleCollapsed()
}
function switchLayout(v) {
  layout.value = v
  setLayout(v)
  sidebarOpen.value = false
}

// 任意视图成功下载都自动记入"最近处理"（取下载发生时的当前路由，并推断文件类型）
setDownloadHook(({ filename }) => { recordUsage(route.path, filename, typeOfName(filename)) })

const groupItems = (g) => NAV.filter((n) => n.group === g)
const themeLabel = computed(() => (theme.value === 'light' ? t('app.darkMode') : t('app.lightMode')))
const themeIcon = computed(() => (theme.value === 'light' ? 'bi-moon-stars' : 'bi-sun'))
const localeLabel = computed(() => LOCALE_SHORT[locale.value] || 'EN')
const isSidebar = computed(() => layout.value === 'sidebar')
// 桌面顶栏布局下，只展示最常用入口，避免拥挤；其余走搜索/命令面板
const TOP_QUICK = ['/zip-compress', '/image-convert', '/pdf-tools', '/qr-code', '/ocr', '/hash']
const topQuickItems = computed(() => TOP_QUICK.map((p) => NAV.find((n) => n.path === p)).filter(Boolean))

// 路由变化时收起移动端抽屉
watch(() => route.fullPath, closeSidebar)
watch(sidebarOpen, (v) => { if (v) nextTick(() => sbCloseEl.value && sbCloseEl.value.focus()) })

function onGlobalKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value = true
  } else if (e.key === 'Escape' && sidebarOpen.value) {
    closeSidebar()
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey))
</script>

<template>
  <div class="app" :class="'layout-' + layout">
    <!-- 移动端抽屉遮罩 -->
    <div v-if="sidebarOpen" class="scrim" @click="closeSidebar"></div>

    <!-- ============ 侧边栏布局（可选） ============ -->
    <aside
      v-if="isSidebar"
      class="sidebar"
      :class="{ open: sidebarOpen, collapsed: sidebarCollapsed }"
      :aria-label="t('app.mainNav')"
    >
      <div class="sb-head">
        <RouterLink to="/" class="brand" @click="closeSidebar">
          <i class="bi bi-box-seam"></i>
          <span class="brand-text">Local<b>Forge</b></span>
        </RouterLink>
        <button ref="sbCloseEl" class="sb-close" type="button" @click="closeSidebar" :aria-label="t('app.closeMenu')">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>

      <button class="sb-search" type="button" @click="openPalette" :title="t('app.searchHint')">
        <i class="bi bi-search"></i>
        <span class="sb-text">{{ t('app.search') }}</span>
        <kbd class="sb-text">Ctrl K</kbd>
      </button>

      <nav class="sb-nav">
        <template v-for="g in NAV_GROUPS" :key="g">
          <div v-if="groupItems(g).length" class="sb-group sb-text">{{ groupLabel(g) }}</div>
          <RouterLink
            v-for="n in groupItems(g)" :key="n.path" :to="n.path"
            class="sb-link" @click="closeSidebar" :title="navTitle(n)"
          >
            <i class="bi" :class="n.icon"></i>
            <span class="sb-text">{{ navTitle(n) }}</span>
          </RouterLink>
        </template>
      </nav>

      <div class="sb-foot">
        <div class="lang-wrap">
          <button class="sb-theme" type="button" @click="toggleLangMenu" :aria-expanded="langOpen" title="切换语言 / Language">
            <i class="bi bi-translate"></i>
            <span class="sb-text">{{ LOCALE_NAMES[locale] }}</span>
          </button>
          <div v-if="langOpen" class="lang-menu up" role="menu">
            <button
              v-for="l in availableLocales" :key="l" type="button" class="lang-item"
              :class="{ active: l === locale }" role="menuitem" @click="pickLocale(l)"
            >
              <i class="bi" :class="l === locale ? 'bi-check-circle-fill' : 'bi-circle'"></i>
              {{ LOCALE_NAMES[l] }}
            </button>
          </div>
        </div>
        <button class="sb-theme" type="button" @click="onToggleTheme" :aria-label="themeLabel" :title="themeLabel">
          <i class="bi" :class="themeIcon"></i>
          <span class="sb-text">{{ themeLabel }}</span>
        </button>
        <button class="sb-theme" type="button" @click="switchLayout('topbar')" :title="t('app.toTopbar')">
          <i class="bi bi-layout-text-window-reverse"></i>
          <span class="sb-text">{{ t('app.toTopbar') }}</span>
        </button>
        <span class="badge sb-text"><i class="bi bi-shield-lock"></i> {{ t('app.localBadge') }}</span>
      </div>
    </aside>

    <!-- ============ 主区域 ============ -->
    <div class="main-col">
      <!-- 顶栏：sidebar 布局下仅在移动端显示；topbar 布局下始终显示 -->
      <header class="topbar" :class="{ 'only-mobile': isSidebar }">
        <button
          class="nav-toggle" type="button" @click="onNavToggle"
          :aria-label="isSidebar ? t('app.openMenu') : t('app.allTools')"
          :title="isSidebar ? t('app.openMenu') : t('app.allTools')"
        >
          <i class="bi bi-list"></i>
        </button>

        <RouterLink to="/" class="brand tb-brand">
          <i class="bi bi-box-seam"></i>
          <span>Local<b>Forge</b></span>
        </RouterLink>

        <nav class="tb-nav" v-if="!isSidebar">
          <RouterLink v-for="n in topQuickItems" :key="n.path" :to="n.path" class="tb-link">
            <i class="bi" :class="n.icon"></i> <span>{{ navShort(n) }}</span>
          </RouterLink>
          <button class="tb-link tb-more" type="button" @click="openPalette">
            <i class="bi bi-grid-3x3-gap"></i> <span>{{ t('app.allTools') }}</span>
          </button>
        </nav>

        <button class="top-search" type="button" @click="openPalette" :aria-label="t('app.search')">
          <i class="bi bi-search"></i>
          <span class="ts-text">{{ t('app.search') }}</span>
          <kbd>⌘K</kbd>
        </button>

        <div class="lang-wrap">
          <button class="icon-btn" type="button" data-testid="locale-toggle" @click="toggleLangMenu" :aria-expanded="langOpen" title="切换语言 / Language">
            <span style="font-size:12px;font-weight:700">{{ localeLabel }}</span>
          </button>
          <div v-if="langOpen" class="lang-menu" role="menu">
            <button
              v-for="l in availableLocales" :key="l" type="button" class="lang-item"
              :class="{ active: l === locale }" role="menuitem" @click="pickLocale(l)"
            >
              <i class="bi" :class="l === locale ? 'bi-check-circle-fill' : 'bi-circle'"></i>
              {{ LOCALE_NAMES[l] }}
            </button>
          </div>
        </div>
        <button class="icon-btn" type="button" data-testid="theme-toggle" @click="onToggleTheme" :aria-label="themeLabel" :title="themeLabel">
          <i class="bi" :class="themeIcon"></i>
        </button>
        <button
          class="icon-btn" type="button" data-testid="layout-toggle" @click="switchLayout(isSidebar ? 'topbar' : 'sidebar')"
          :title="isSidebar ? t('app.toTopbar') : t('app.toSidebar')" :aria-label="t('app.toSidebar')"
        >
          <i class="bi" :class="isSidebar ? 'bi-layout-text-window-reverse' : 'bi-layout-sidebar-inset'"></i>
        </button>
      </header>

      <main class="content">
        <RouterView />
      </main>

      <footer class="footer">
        <nav class="foot-nav">
          <RouterLink to="/about">{{ t('nav.about') }}</RouterLink>
          <RouterLink to="/privacy">{{ t('nav.privacy') }}</RouterLink>
          <a href="https://github.com/javaeer/local-forge" target="_blank" rel="noopener">GitHub</a>
        </nav>
        <div>{{ t('footer.note') }}</div>
      </footer>
    </div>

    <!-- 移动端底部标签栏 -->
    <nav class="tabbar" :aria-label="t('app.quickNav')">
      <RouterLink v-for="n in TAB_ITEMS" :key="n.path" :to="n.path" class="tab">
        <i class="bi" :class="n.icon"></i>
        <span>{{ navShort(n) }}</span>
      </RouterLink>
      <button class="tab" type="button" @click="openPalette">
        <i class="bi bi-grid-3x3-gap"></i>
        <span>{{ t('app.all') }}</span>
      </button>
    </nav>

    <CommandPalette v-model:open="paletteOpen" />
    <ToastHost />
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: row; min-height: 100%; }

/* ---------- 通用品牌 ---------- */
.brand { display: flex; align-items: center; gap: 9px; font-size: 18px; font-weight: 700; color: var(--txt, #e8edf7); text-decoration: none; letter-spacing: .3px; }
.brand i { color: var(--accent, #38bdf8); font-size: 21px; filter: drop-shadow(0 0 8px rgba(56,189,248,.55)); }
.brand b { background: var(--grad, linear-gradient(120deg,#38bdf8,#a78bfa)); -webkit-background-clip: text; background-clip: text; color: transparent; }

/* ---------- 侧边栏 ---------- */
.sidebar {
  width: 250px; flex: none;
  position: sticky; top: 0; align-self: flex-start;
  height: 100vh;
  display: flex; flex-direction: column;
  background: var(--panel-2, rgba(28,37,60,.75));
  border-right: 1px solid var(--line, rgba(120,150,200,.16));
  backdrop-filter: blur(12px);
  z-index: 40;
  transition: width .2s ease;
}
/* 桌面收起态：56px 图标窄栏，悬停展开 */
.sidebar.collapsed { width: 56px; }
.sidebar.collapsed .sb-text { display: none; }
.sidebar.collapsed .sb-link, .sidebar.collapsed .sb-search, .sidebar.collapsed .sb-theme { justify-content: center; }
.sidebar.collapsed:hover { width: 250px; }
.sidebar.collapsed:hover .sb-text { display: inline; }
.sidebar.collapsed:hover .sb-link, .sidebar.collapsed:hover .sb-search, .sidebar.collapsed:hover .sb-theme { justify-content: flex-start; }

.sb-head { display: flex; align-items: center; gap: 8px; padding: 14px 14px 10px; }
.sb-head .brand { flex: 1; overflow: hidden; white-space: nowrap; }
.sb-close { display: none; border: none; background: transparent; color: var(--muted, #93a2bd); font-size: 20px; cursor: pointer; padding: 4px 6px; border-radius: 8px; }
.sb-close:hover { color: var(--txt, #e8edf7); background: var(--panel-solid, #121a2c); }

.sb-search {
  display: flex; align-items: center; gap: 8px;
  margin: 4px 12px 10px; padding: 9px 11px; cursor: pointer;
  border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  border-radius: 10px; background: var(--panel-solid, #121a2c);
  color: var(--muted, #93a2bd); font-size: 13.5px; transition: .15s; white-space: nowrap;
}
.sidebar.collapsed .sb-search { margin: 4px 8px 10px; }
.sb-search:hover { border-color: var(--accent, #38bdf8); color: var(--txt, #e8edf7); }
.sb-search i { font-size: 15px; flex: none; }
.sb-search kbd { margin-left: auto; }

.sb-nav { flex: 1; overflow: auto; padding: 4px 10px 12px; display: flex; flex-direction: column; gap: 1px; }
.sb-group { font-size: 11px; color: var(--faint, #6b7a96); letter-spacing: .5px; text-transform: uppercase; padding: 12px 8px 4px; white-space: nowrap; }
.sb-link {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 9px;
  color: var(--muted, #93a2bd); text-decoration: none; font-size: 13.5px; transition: .15s; white-space: nowrap;
}
.sb-link i { font-size: 16px; width: 18px; text-align: center; flex: none; }
.sb-link:hover { background: var(--panel-solid, #121a2c); color: var(--txt, #e8edf7); }
.sb-link.router-link-active { background: var(--grad-soft, rgba(56,189,248,.12)); color: var(--accent, #38bdf8); border: 1px solid rgba(56,189,248,.35); }

.sb-foot { padding: 10px 12px; border-top: 1px solid var(--line, rgba(120,150,200,.16)); display: flex; flex-direction: column; gap: 8px; }
.sb-theme {
  display: flex; align-items: center; gap: 8px; cursor: pointer; white-space: nowrap;
  padding: 9px 11px; border-radius: 10px; font-size: 13.5px;
  border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  background: var(--panel-solid, #121a2c); color: var(--txt, #e8edf7); transition: .15s;
}
.sb-theme:hover { border-color: var(--accent, #38bdf8); color: var(--accent, #38bdf8); }
.sb-theme i { font-size: 15px; flex: none; }

/* ---------- 主列 + 顶栏 ---------- */
.main-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 18px; border-bottom: 1px solid var(--line, rgba(120,150,200,.16));
  background: var(--topbar-bg, rgba(8, 12, 22, 0.7)); backdrop-filter: blur(12px);
  position: sticky; top: 0; z-index: 20;
}
.nav-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; flex: none; border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  border-radius: 10px; background: var(--panel-2, rgba(28,37,60,.75));
  color: var(--txt, #e8edf7); cursor: pointer; font-size: 19px;
}
.nav-toggle:focus-visible, .icon-btn:focus-visible { outline: 2px solid var(--accent, #38bdf8); outline-offset: 2px; }
.tb-brand { flex: none; margin-right: 4px; }
.tb-nav { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
.tb-link {
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 9px;
  color: var(--muted, #93a2bd); text-decoration: none; font-size: 13.5px; white-space: nowrap;
  background: transparent; border: 1px solid transparent; cursor: pointer; transition: .15s;
}
.tb-link:hover { background: var(--panel-2, rgba(28,37,60,.75)); color: var(--txt, #e8edf7); border-color: var(--line, rgba(120,150,200,.16)); }
.tb-link.router-link-active { background: var(--grad-soft, rgba(56,189,248,.12)); color: var(--accent, #38bdf8); border-color: rgba(56,189,248,.35); }
.tb-link i { font-size: 15px; }

.top-search {
  display: flex; align-items: center; gap: 8px; margin-left: auto;
  padding: 8px 11px; cursor: pointer; border-radius: 10px; white-space: nowrap;
  border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  background: var(--panel-solid, #121a2c); color: var(--muted, #93a2bd); font-size: 13px;
}
.top-search:hover { border-color: var(--accent, #38bdf8); color: var(--txt, #e8edf7); }
.top-search kbd { margin-left: 6px; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 38px; height: 38px; border-radius: 10px; cursor: pointer; font-size: 16px;
  border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  background: var(--panel-2, rgba(28,37,60,.75)); color: var(--txt, #e8edf7); transition: .15s;
}
.icon-btn:hover { border-color: var(--accent, #38bdf8); color: var(--accent, #38bdf8); }

/* 语言下拉（B-4：中日英韩西五语） */
.lang-wrap { position: relative; display: inline-flex; }
.lang-menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
  min-width: 150px; padding: 6px; border-radius: 12px;
  background: var(--topbar-bg, rgba(10,15,26,.98)); backdrop-filter: blur(16px);
  border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  box-shadow: 0 12px 32px rgba(0,0,0,.4);
  display: flex; flex-direction: column; gap: 2px;
}
.lang-menu.up { top: auto; bottom: calc(100% + 8px); right: auto; left: 0; }
.lang-item {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
  padding: 8px 10px; border-radius: 8px; border: none; background: transparent; cursor: pointer;
  color: var(--txt, #e8edf7); font-size: 13px; transition: .12s;
}
.lang-item:hover { background: var(--grad-soft, rgba(56,189,248,.12)); }
.lang-item.active { color: var(--accent, #38bdf8); }
.lang-item i { font-size: 13px; color: var(--muted, #93a2bd); }
.lang-item.active i { color: var(--accent, #38bdf8); }

.scrim { display: none; position: fixed; inset: 0; z-index: 35; background: rgba(4, 8, 16, 0.5); backdrop-filter: blur(2px); }

.foot-nav { display: flex; gap: 16px; justify-content: center; margin-bottom: 8px; flex-wrap: wrap; }
.foot-nav a { color: var(--accent, #38bdf8); text-decoration: none; font-size: 13px; }
.foot-nav a:hover { text-decoration: underline; }

kbd {
  font-family: var(--mono, monospace); font-size: 11px; padding: 1px 6px; border-radius: 5px;
  border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  background: var(--panel-2, rgba(28,37,60,.55)); color: var(--muted, #93a2bd);
}

/* 底部标签栏：仅移动端显示 */
.tabbar { display: none; }

/* ============ 响应式 ============ */
/* 平板及以下：统一走「移动外壳」——顶栏 + 抽屉 + 底部标签栏 */
@media (max-width: 960px) {
  .topbar { padding: 10px 12px; gap: 8px; }
  .tb-nav { display: none; }              /* 快捷入口下沉到底部标签栏 */
  .top-search { margin-left: 0; flex: 1; }
  .tb-brand { display: none; }            /* 移动端顶栏只留 菜单/搜索/工具 */
  .top-search .ts-text { flex: 1; }

  .sidebar {
    position: fixed; top: 0; left: 0; bottom: 0; height: 100%;
    width: 250px !important;
    transform: translateX(-100%); transition: transform .22s ease;
    box-shadow: 0 20px 50px rgba(0,0,0,.5);
  }
  .sidebar.open { transform: translateX(0); }
  .sidebar.collapsed .sb-text { display: inline; }   /* 移动端不做窄栏 */
  .sidebar.collapsed .sb-link, .sidebar.collapsed .sb-search, .sidebar.collapsed .sb-theme { justify-content: flex-start; }
  .sb-close { display: inline-flex; }
  .scrim { display: block; }

  /* 底部标签栏 */
  .tabbar {
    display: flex; justify-content: space-around; align-items: stretch;
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 45;
    background: var(--tabbar-bg, rgba(8, 12, 22, 0.94)); backdrop-filter: blur(14px);
    border-top: 1px solid var(--line, rgba(120,150,200,.16));
    padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
  }
  .tab {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 6px 2px; border: none; background: transparent; cursor: pointer;
    color: var(--muted, #93a2bd); text-decoration: none; font-size: 11px;
  }
  .tab i { font-size: 20px; }
  .tab.router-link-active { color: var(--accent, #38bdf8); }
  /* 给底部标签栏留出空间，避免遮挡页脚 */
  .content { padding-bottom: 76px; }
  .footer { padding-bottom: 76px; }
}
@media (max-width: 520px) {
  .top-search kbd { display: none; }
}
</style>
