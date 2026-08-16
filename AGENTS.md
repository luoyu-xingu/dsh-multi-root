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
`@luoyu-xingu/dsh-multi-root-live3` 安装：profile 里的
`node_modules/@luoyu-xingu/dsh-multi-root-live3` 是 junction，直接指向源仓库
`E:\dsh_plugins\dsh-multi-root`（没有中间拷贝目录，web 加载的就是仓库 lib），
patch 行在 profile 的 `cordis.patch.yml`。宿主半区自带 self hot reload
（`src/hmr.ts`）：监听自身 lib 文件，变更即清模块缓存并原位重挂载。

**关键约束（客户端 bundle 的注册 id 必须等于 loader entry 名）**：dsh web
的 boot manifest 按 loader entry 名（`-live3`）请求并核对 client bundle，
bundle 头部的 `__ModuleLoader__.load({ id })` 必须注册同名，否则浏览器端
报 `loaded without registering "<entry名>"`，整个 GUI 无法启动。tsdown 的
ID 默认取包本名 `@luoyu-xingu/dsh-multi-root`，别名部署必须用环境变量构建。
更新流程：

1. `pnpm typecheck && pnpm test`
2. 用 live3 别名构建（覆盖默认 id）：
   `set DSH_PLUGIN_CLIENT_ID=@luoyu-xingu/dsh-multi-root-live3 && pnpm bundle`
3. 产物直接落在源仓库 `lib/`（profile junction 指向仓库，web 即从仓库 lib
   加载，无需任何拷贝）；等约 10 秒（自愈重载生效），浏览器刷新即得新客户端
   bundle（rev 随内容哈希自动变化）。

移除插件（必须两步都做，缺一即 web 无法启动）：

1. 删除 `cordis.patch.yml` 里的 insert 条目（只删包不删条目 → 宿主启动报
   `Cannot find package '@luoyu-xingu/dsh-multi-root-live3'`）。
2. 删除 profile 的 `node_modules/@luoyu-xingu/dsh-multi-root-live3`
   junction（只删链接本身，勿用 -Recurse；源仓库本身不动）。

注意：ESM 模块缓存按「真实路径 URL」钉死，若 self-HMR 本身被改坏，恢复
需换新别名（新行名）+ 新真实目录冷激活一次；patch 行名必须保留
`@luoyu-xingu/dsh-multi-root*` 前缀（hmr.ts 按前缀找自己的 loader 条目）。

