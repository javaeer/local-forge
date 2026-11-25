<script setup>
// 首页任务入口层：从「我要锻造什么」出发，一步直达现有工序。
// 纯呈现组件：一级任务与二级分组来自 tasks.js，工序标题/图标从 formats.js 反查，
// 命令面板只 emit，由 Home.vue 注入 App.vue 已有的 openPalette。
import { ref, onMounted } from 'vue'
import { TASKS, taskSteps, taskChildren } from '../lib/tasks.js'
import { hasResume } from '../lib/resume.js'
import { T } from '../lib/i18n.dev.js'

const emit = defineEmits(['open-palette'])

// 二级就地展开：仅组件内存状态，不入历史、不持久化，刷新回到 4 卡简洁态。
const expanded = ref({})
function toggle(id) { expanded.value = { ...expanded.value, [id]: !expanded.value[id] } }

// 可恢复徽标：任务任一工序存在有效快照时点亮（返回首页挂载即刷新）。
const resumable = ref({})
onMounted(() => {
  const mark = {}
  for (const task of TASKS) {
    mark[task.id] = [...task.steps, ...(task.children || []).flatMap((c) => c.steps)]
      .some((to) => hasResume(to.split('?')[0]))
  }
  resumable.value = mark
})
</script>

<template>
  <section class="taskboard" :aria-label="T('task.ariaLabel')">
    <div class="task-grid">
      <article v-for="task in TASKS" :key="task.id" class="task-card" :data-task="task.id">
        <header class="task-head">
          <span class="task-icon"><i class="bi" :class="task.icon"></i></span>
          <div>
            <h2>{{ T(task.titleKey) }}<span v-if="resumable[task.id]" class="resume-dot" :title="T('task.resumeBadge')" :aria-label="T('task.resumeBadge')"></span></h2>
            <p>{{ T(task.descKey) }}</p>
          </div>
        </header>
        <div class="task-steps">
          <RouterLink
            v-for="step in taskSteps(task.steps)" :key="step.to"
            :to="step.to" class="task-step" :data-step="step.to"
          >
            <i class="bi" :class="step.icon"></i>
            <span>{{ step.titleKey ? T(step.titleKey) : step.title }}</span>
            <i class="bi bi-arrow-right-short step-arrow"></i>
          </RouterLink>
        </div>

        <template v-if="task.children && task.children.length">
          <button
            type="button" class="more-toggle" :data-more="task.id"
            :aria-expanded="!!expanded[task.id]" @click="toggle(task.id)"
          >
            <i class="bi" :class="expanded[task.id] ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
            {{ T(expanded[task.id] ? 'task.less' : 'task.more') }}
          </button>
          <div v-if="expanded[task.id]" class="task-children">
            <div v-for="child in taskChildren(task)" :key="child.id" class="child-group">
              <h3 class="child-title">{{ T(child.titleKey) }}</h3>
              <div class="child-steps">
                <RouterLink
                  v-for="step in child.steps" :key="step.to"
                  :to="step.to" class="child-step" :data-step="step.to"
                >
                  <i class="bi" :class="step.icon"></i>
                  <span>{{ step.titleKey ? T(step.titleKey) : step.title }}</span>
                </RouterLink>
              </div>
            </div>
          </div>
        </template>
      </article>
    </div>

    <div class="task-quick">
      <button type="button" class="quick" data-cta="cmd" @click="emit('open-palette')">
        <i class="bi bi-search"></i> {{ T('task.cmdCta') }}
      </button>
      <a class="quick" href="#recent" data-cta="recent">
        <i class="bi bi-clock-history"></i> {{ T('task.recentCta') }}
      </a>
      <a class="quick" href="#all-tools" data-cta="all">
        <i class="bi bi-grid"></i> {{ T('task.allTools') }}
      </a>
    </div>
  </section>
</template>

<style scoped>
.taskboard { margin: 18px 0 22px; }
.task-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
  align-items: start;
}
.task-card {
  border: 1px solid var(--line, rgba(120,150,200,.16));
  border-radius: 14px;
  padding: 15px 15px 12px;
  background: linear-gradient(155deg, var(--panel-2, rgba(28,37,60,.55)), var(--panel, rgba(20,27,45,.7)));
  box-shadow: 0 6px 18px rgba(0,0,0,.08);
  transition: border-color .15s, transform .15s;
}
.task-card:hover {
  border-color: rgba(232,149,74,.5);
}
.task-head { display: flex; align-items: flex-start; gap: 11px; margin-bottom: 12px; }
.task-icon {
  flex: none; width: 36px; height: 36px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--accent, #e8954a);
  background: var(--grad-soft, rgba(232,149,74,.12));
  border: 1px solid rgba(232,149,74,.28);
  font-size: 18px;
}
.task-head h2 { font-size: 15px; line-height: 1.3; margin: 1px 0 3px; font-weight: 700; }
.resume-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent, #e8954a); margin-left: 7px; vertical-align: middle;
  box-shadow: 0 0 0 3px rgba(232,149,74,.18);
}
.task-head p { font-size: 12px; line-height: 1.5; color: var(--muted, #93a2bd); margin: 0; }
.task-steps { display: flex; flex-direction: column; gap: 5px; }
.task-step {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 9px; border-radius: 9px; font-size: 12.5px;
  color: var(--txt, #e8edf7); text-decoration: none;
  background: rgba(127,127,127,.06);
  border: 1px solid transparent;
  transition: .14s;
}
.task-step:hover {
  background: var(--grad-soft, rgba(232,149,74,.1));
  border-color: rgba(232,149,74,.35);
  color: var(--accent, #e8954a);
}
.task-step > i:first-child { width: 16px; text-align: center; color: var(--accent, #e8954a); }
.task-step span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step-arrow { margin-left: auto; color: var(--faint, #6b7a96); }

.more-toggle {
  margin-top: 9px; width: 100%;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 6px 9px; border-radius: 9px; cursor: pointer;
  font-size: 11.5px; color: var(--muted, #93a2bd);
  background: transparent; border: 1px dashed var(--line, rgba(120,150,200,.16));
  transition: .14s;
}
.more-toggle:hover { color: var(--accent, #e8954a); border-color: rgba(232,149,74,.4); }
.task-children {
  margin-top: 9px; padding-top: 9px;
  border-top: 1px solid var(--line, rgba(120,150,200,.12));
  display: flex; flex-direction: column; gap: 10px;
}
.child-title {
  font-size: 11px; font-weight: 700; letter-spacing: .3px;
  color: var(--accent, #e8954a); margin: 0 0 5px;
}
.child-steps { display: flex; flex-direction: column; gap: 3px; }
.child-step {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 8px; border-radius: 7px; font-size: 11.5px;
  color: var(--muted, #93a2bd); text-decoration: none;
  transition: .14s;
}
.child-step i { width: 14px; text-align: center; color: var(--faint, #6b7a96); }
.child-step span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.child-step:hover { color: var(--accent, #e8954a); background: var(--grad-soft, rgba(232,149,74,.08)); }

.task-quick { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.quick {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 12px; border-radius: 999px; cursor: pointer;
  font-size: 12px; text-decoration: none;
  color: var(--muted, #93a2bd);
  background: var(--panel-2, rgba(28,37,60,.55));
  border: 1px solid var(--line, rgba(120,150,200,.16));
  transition: .15s;
}
.quick:hover { color: var(--accent, #e8954a); border-color: rgba(232,149,74,.45); }
.quick i { color: var(--accent, #e8954a); }
/* 键盘焦点不能只依赖 :hover */
.task-step:focus-visible,
.child-step:focus-visible,
.more-toggle:focus-visible,
.quick:focus-visible {
  outline: 2px solid var(--accent, #e8954a);
  outline-offset: 2px;
}
</style>
