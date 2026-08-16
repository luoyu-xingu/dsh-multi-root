/**
 * Locale dictionaries for the multi-root panel surface. `zh` is the key
 * source; `en` mirrors the same key set (i18n discipline of the dsh-web-ui
 * family). Registered through `ctx.locale.register`.
 * @module @luoyu_xingu/dsh-multi-root/client/locales
 */

/** Template values accepted by the interpolator. */
export type TranslateValues = Record<string, string | number>

/** The panel's surface copy keys. */
export type MultiRootKey =
  | 'entry.label'
  | 'entry.tooltip'
  | 'panel.title'
  | 'panel.empty'
  | 'panel.add.title'
  | 'panel.add.pathPlaceholder'
  | 'panel.add.namePlaceholder'
  | 'panel.add.browse'
  | 'panel.add.submit'
  | 'panel.add.hint'
  | 'panel.browse.title'
  | 'panel.browse.drives'
  | 'panel.browse.select'
  | 'panel.browse.up'
  | 'panel.browse.cancel'
  | 'panel.browse.current'
  | 'panel.root.statusOk'
  | 'panel.root.statusMissing'
  | 'panel.root.remove'
  | 'panel.root.rename'
  | 'panel.root.moveUp'
  | 'panel.root.moveDown'
  | 'panel.root.saveName'
  | 'panel.root.cancel'
  | 'panel.footer.hint'
  | 'panel.error.load'

export const zh: Record<MultiRootKey, string> = {
  'entry.label': '多根',
  'entry.tooltip': '多根工作区：挂载多个独立文件夹，全部平等、全局共享',
  'panel.title': '多根工作区',
  'panel.empty': '还没有挂载文件夹。在上面添加一个目录，之后 agent 就能用 workspace_root_* 工具跨根读写。',
  'panel.add.title': '挂载文件夹',
  'panel.add.pathPlaceholder': '文件夹绝对路径，例如 D:\\projects\\frontend',
  'panel.add.namePlaceholder': '别名（可选，默认取文件夹名）',
  'panel.add.browse': '浏览',
  'panel.add.submit': '添加',
  'panel.add.hint': '只能挂载存在的目录，可先选择盘符再逐级进入。',
  'panel.browse.title': '选择文件夹',
  'panel.browse.drives': '选择盘符',
  'panel.browse.select': '选择此目录',
  'panel.browse.up': '上一级',
  'panel.browse.cancel': '取消',
  'panel.browse.current': '当前目录',
  'panel.root.statusOk': '可用',
  'panel.root.statusMissing': '目录缺失',
  'panel.root.remove': '移除',
  'panel.root.rename': '重命名',
  'panel.root.moveUp': '上移',
  'panel.root.moveDown': '下移',
  'panel.root.saveName': '保存',
  'panel.root.cancel': '取消',
  'panel.footer.hint': 'Agent 工具：workspace_roots / workspace_root_list / workspace_root_read / workspace_root_write / workspace_root_glob',
  'panel.error.load': '加载失败',
}

export const en: Record<MultiRootKey, string> = {
  'entry.label': 'Roots',
  'entry.tooltip': 'Multi-root workspace: attach several independent folders, all equal and shared globally',
  'panel.title': 'Multi-Root Workspace',
  'panel.empty': 'No folders attached yet. Add one above; agents can then read and write across roots with the workspace_root_* tools.',
  'panel.add.title': 'Attach a folder',
  'panel.add.pathPlaceholder': 'Absolute folder path, e.g. D:\\projects\\frontend',
  'panel.add.namePlaceholder': 'Alias (optional; defaults to the folder name)',
  'panel.add.browse': 'Browse',
  'panel.add.submit': 'Add',
  'panel.add.hint': 'Only existing directories can be attached; pick a drive first, then drill down.',
  'panel.browse.title': 'Choose a folder',
  'panel.browse.drives': 'Choose a drive',
  'panel.browse.select': 'Choose this directory',
  'panel.browse.up': 'Up',
  'panel.browse.cancel': 'Cancel',
  'panel.browse.current': 'Current directory',
  'panel.root.statusOk': 'available',
  'panel.root.statusMissing': 'directory missing',
  'panel.root.remove': 'Remove',
  'panel.root.rename': 'Rename',
  'panel.root.moveUp': 'Move up',
  'panel.root.moveDown': 'Move down',
  'panel.root.saveName': 'Save',
  'panel.root.cancel': 'Cancel',
  'panel.footer.hint': 'Agent tools: workspace_roots / workspace_root_list / workspace_root_read / workspace_root_write / workspace_root_glob',
  'panel.error.load': 'Failed to load',
}

/** Interpolate `{name}` placeholders in a translated string. */
export function t(dictionary: Record<string, string>, key: MultiRootKey, values?: TranslateValues): string {
  let out = dictionary[key] ?? key
  if (values !== undefined) {
    for (const [name, value] of Object.entries(values)) {
      out = out.replaceAll(`{${name}}`, String(value))
    }
  }
  return out
}

/** Active dictionary, picked by the document language at call time. */
export function dictionary(): Record<string, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? { ...en } : { ...zh }
}

/** Translate a key with optional `{name}` template params (current language). */
export function tt(key: MultiRootKey, values?: TranslateValues): string {
  return t(dictionary(), key, values)
}

/** Human-readable error text from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
