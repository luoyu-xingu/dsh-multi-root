# AGENTS.md — dsh-multi-root 仓库规则

DeepSeek Harness Web GUI 的多根工作区插件：宿主进程内的持久根目录存储 +
/api/dsh-multi-root 路由（仅 loopback）+ agent 工具，以及 Web GUI 侧边栏入口
与管理面板。独立 cordis bundle 包，热插拔安装，不改 DSH 源码。

## 仓库布局

```text
src/index.ts        宿主半区（store + 路由 + 工具 + 提示词段落）
src/store.ts        ~/.dsh/dsh-multi-root.json 持久化（0600 原子写）
src/fs-ops.ts       受控文件操作（realpath 围栏，唯一安全边界）
src/tools.ts        5 个 agent 工具（workspace_roots / *_list / *_read / *_write / *_glob）
src/routes.ts       /api/dsh-multi-root/*（loopback + 同源标记）
src/invariant.ts    两侧共享常量（API 路径 / 上限 / 提示词）
src/core/types.ts   两侧共享类型（无运行时代码）
src/client/         浏览器半区（locales / api / sidebar-entry / panel / mount）
tests/              单测（store / fs-ops / tools / client 冒烟）
```

## 安全模型（本包最重的纪律）

- **本插件绕过 DSH 文件沙箱**：fs-ops 以宿主进程权限直接读写磁盘。信任边界
  是用户登记的根目录集合，每次操作必须过 `fs-ops.ts` 的 realpath 围栏：
  相对路径拼接拒绝 `..` / 绝对路径 / 盘符；读取对最终路径做 realpath 并校验
  在根内；写入额外校验解析后的父目录与已存在目标的 realpath。
- 根目录只能由**用户在 GUI** 挂载 / 移除（路由仅 loopback + 同源标记）；
  agent 无任何挂载工具。
- 任何放宽围栏、增加工具（尤其是执行类）或改动路由的修改，必须同步更新
  `README*.md` 的「安全模型」章节与对应测试。

## 构建与提交前检查

```sh
pnpm typecheck   # tsc -b（host/client 两个 program）+ 测试 program
pnpm test        # vitest run
pnpm build       # tsc -b && tsdown
```

- 提交信息 Conventional Commits（`feat(scope): subject`），无 emoji（代码、
  注释、文档、提交信息同样禁止）。
- README 中英三件套（`README.md` + `README.zh.md` + `README.i18n.yaml`）随
  行为变化同步更新。
- 客户端代码禁止使用 node API（bundle 纯度门只拦 @deepseek-ai 值导入，
  不拦 node 全局）；样式走 CSS Modules（`*.module.css`）。

## 本机热部署（dsh web 不重启）

本机 profile（`~/.dsh/profiles/web`）以别名
`@luoyu-xingu/dsh-multi-root-live3` 链接到部署目录
`E:\dsh_plugins\dsh-multi-root-live2`（真实拷贝 + node_modules junction），
patch 行在 profile 的 `cordis.patch.yml`。宿主半区自带 self hot reload
（`src/hmr.ts`）：监听自身 lib 文件，变更即清模块缓存并原位重挂载。
更新流程：

1. `pnpm typecheck && pnpm test && pnpm build`
2. `Copy-Item lib\* E:\dsh_plugins\dsh-multi-root-live2\lib\ -Recurse -Force`
3. 等约 10 秒（自愈重载生效），浏览器刷新即得新客户端 bundle。

注意：ESM 模块缓存按「真实路径 URL」钉死，若 self-HMR 本身被改坏，恢复
需换新别名（新行名）+ 新真实目录冷激活一次；patch 行名必须保留
`@luoyu-xingu/dsh-multi-root*` 前缀（hmr.ts 按前缀找自己的 loader 条目）。

