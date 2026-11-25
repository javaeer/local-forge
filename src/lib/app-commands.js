// 全局应用命令总线：用 Symbol 作为 provide/inject key，避免字符串 key 散落与碰撞。
// 当前只承载 openPalette；后续新增收藏、资源管理器、诊断等动作时统一挂在这里，
// 不再在组件间逐个 provide 字符串。
export const APP_COMMANDS_KEY = Symbol('appCommands')
