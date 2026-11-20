<script setup>
// steps: [{ label, state }]  state: 'done' | 'active' | 'todo' | 'error'
defineProps({
  steps: { type: Array, default: () => [] },
})
</script>

<template>
  <ol class="stepbar">
    <li v-for="(s, i) in steps" :key="i" class="step" :class="s.state || 'todo'">
      <span class="dot">
        <i v-if="s.state === 'done'" class="bi bi-check-lg"></i>
        <i v-else-if="s.state === 'error'" class="bi bi-exclamation-lg"></i>
        <template v-else>{{ i + 1 }}</template>
      </span>
      <span class="lbl">{{ s.label }}</span>
      <span v-if="i < steps.length - 1" class="bar"></span>
    </li>
  </ol>
</template>

<style scoped>
.stepbar {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  padding: 0;
  margin: 14px 0 4px;
}
.step {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 16px 6px 0;
  color: var(--muted, #93a2bd);
  font-size: 13px;
  flex: 0 0 auto;
}
.dot {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  background: var(--panel-solid, #121a2c);
  color: var(--muted, #93a2bd);
  font-family: var(--mono, monospace);
  z-index: 1;
}
.bar {
  position: absolute;
  left: 24px;
  top: 50%;
  width: 16px;
  height: 2px;
  background: var(--line, rgba(120,150,200,.16));
  transform: translateY(-50%);
}
.step.active { color: var(--txt, #e6ebf2); }
.step.active .dot {
  border-color: var(--accent, #38bdf8);
  color: var(--accent, #38bdf8);
  box-shadow: 0 0 12px rgba(232,149,74,.4);
}
.step.done .dot {
  border-color: var(--accent-2, #34d399);
  background: linear-gradient(120deg, #34d399, #22d3ee);
  color: #04121f;
}
.step.done .bar { background: var(--accent-2, #34d399); }
.step.error .dot {
  border-color: var(--danger, #fb7185);
  color: var(--danger, #fb7185);
}
.step.error { color: var(--danger, #fb7185); }
.lbl { white-space: nowrap; }
</style>
