<script setup>
// 首页任务入口层：从「我要锻造什么」出发，一步直达现有工序。
// 纯呈现组件：任务数据来自 tasks.js，标题/图标从 formats.js 反查，
// 命令面板只 emit，由 Home.vue 注入 App.vue 已有的 openPalette。
import { TASKS, taskSteps } from '../lib/tasks.js'
import { T } from '../lib/i18n.dev.js'

const emit = defineEmits(['open-palette'])
</script>

<template>
  <section class="taskboard" aria-label="任务入口">
    <div class="task-grid">
      <article v-for="task in TASKS" :key="task.id" class="task-card" :data-task="task.id">
        <header class="task-head">
          <span class="task-icon"><i class="bi" :class="task.icon"></i></span>
          <div>
            <h2>{{ T(task.titleKey) }}</h2>
            <p>{{ T(task.descKey) }}</p>
          </div>
        </header>
        <div class="task-steps">
          <RouterLink
            v-for="step in taskSteps(task)" :key="step.to"
            :to="step.to" class="task-step" :data-step="step.to"
          >
            <i class="bi" :class="step.icon"></i>
            <span>{{ step.titleKey ? T(step.titleKey) : step.title }}</span>
            <i class="bi bi-arrow-right-short step-arrow"></i>
          </RouterLink>
        </div>
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
  transform: translateY(-2px);
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
</style>
