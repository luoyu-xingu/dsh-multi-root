/**
 * Package invariants shared by both halves: API paths, operation caps, and
 * the model-facing guidance text. This file must stay platform-free — the
 * browser bundle compiles it too, so no node imports are allowed here.
 * @module @luoyu-xingu/dsh-multi-root/invariant
 */

/** Npm identity, used for the module-loader handoff and the injected style tags. */
export const PLUGIN_ID = '@luoyu-xingu/dsh-multi-root'

/** Stable cordis plugin name (the bundle row id). */
export const PLUGIN_NAME = 'multi-root'

/** HTTP route family prefix (loopback-only, same-origin fenced). */
export const API_PREFIX = '/api/dsh-multi-root'

/** The exact route paths of the family. */
export const API = {
  roots: `${API_PREFIX}/roots`,
  rootsRemove: `${API_PREFIX}/roots/remove`,
  rootsRename: `${API_PREFIX}/roots/rename`,
  rootsReorder: `${API_PREFIX}/roots/reorder`,
  browse: `${API_PREFIX}/browse`,
} as const

/** Cap on JSON request bodies. */
export const MAX_JSON_BODY_BYTES = 64 * 1024

/** Text files larger than this are truncated on read (the tail is reported). */
export const MAX_READ_BYTES = 256 * 1024

/** Text content larger than this is rejected on write. */
export const MAX_WRITE_BYTES = 5 * 1024 * 1024

/** Directory listings cap (the remainder is reported as truncated). */
export const MAX_LIST_ENTRIES = 500

/** Glob result cap (the remainder is reported as truncated). */
export const MAX_GLOB_MATCHES = 1000

/** Order of the announcement section within the tool-guidance band (100-199). */
export const SECTION_ORDER = 180

/**
 * Model-facing announcement: plugin presence, capabilities, and limits.
 * Kept in the same band the dsh-ssh / task-board plugins use.
 */
export const GUIDANCE = '本机已安装 dsh-multi-root 插件（DSH 多根工作区）：侧边栏「多根」入口；用户可为 DSH 挂载多个独立文件夹（根目录），所有根一律平等、全局共享。能力：workspace_roots 列出全部根；workspace_root_list / workspace_root_read / workspace_root_write / workspace_root_glob 在任意已挂载根内做目录列举、文本读取、文本写入与 glob 匹配。限制：根目录只能由用户在 GUI 面板中挂载或移除，agent 不得自行添加；这些工具绕过 DSH 文件沙箱、以宿主进程权限直接读写用户登记的根目录，且严格限制在根目录内部（含路径穿越与符号链接逃逸防护）；读取超过 256KB 自动截断；写入会真实覆盖磁盘文件，覆盖已存在文件前先向用户确认；列举与 glob 结果有数量上限。用户提到「多根工作区 / 挂载文件夹 / 额外根目录 / 外部项目目录 / 跨项目读写」时即指本插件，请据此协作。'
