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

## 发布与安装（npm 跨平台分发）

插件以标准 npm 包分发（`npm pack --dry-run` 核对：lib 产物 + 类型声明 +
src + cordis.patch.yml + README 三件套，files 白名单已配好，无
.gitignore 干扰）。**这是 Linux/macOS 的唯一安装途径**——`file:` 安装把
Windows 绝对路径写进 profile package.json，不可移植。发布流程：

```sh
pnpm typecheck && pnpm test && pnpm bundle   # 先过门禁（默认 ID 即匹配包本名）
npm publish                                  # 需 npm login（registry.npmjs.org）
```

安装（任意平台）：

```sh
dsh plugin --profile web add @luoyu_xingu/dsh-multi-root
# 或手动：profile package.json dependencies 加 "@luoyu_xingu/dsh-multi-root": "^0.1.0"
```

装完重启 dsh web。发布前注意：npm scope 包要求登录账号拥有该 scope
（scope 名需与 npm 账号 luoyu_xingu 匹配，否则 403）；版本号用 `npm version patch`
递增，发布后本地开发仍走 file:，二者不冲突。

## 本机部署（自包含拷贝，无别名、无 junction；仅限本地开发）

本机 profile（`~/.dsh/profiles/web`）以**包本名** `@luoyu_xingu/dsh-multi-root`
安装：profile 的 `node_modules/@luoyu_xingu/dsh-multi-root` 是**真实目录**
（lib + package.json + cordis.patch.yml + 自带的 node_modules 运行时依赖），
不引用仓库外部路径。行注入走插件自带的 `cordis.bundle.patch`
（`cordis.patch.yml` 的 `insert` 行），profile 的 `cordis.patch.yml` 不再
手动插行；profile package.json 里声明 `"@luoyu_xingu/dsh-multi-root":
"file:E:/dsh_plugins/dsh-multi-root"`（防 pnpm install 修剪，装完后是
自包含拷贝）。宿主半区的 self hot reload（`src/hmr.ts`）在 web profile 中
因 hmr 服务禁用而不生效，更新一律重启。

**关键约束（客户端 bundle 的注册 id 必须等于 loader entry 名）**：dsh web
的 boot manifest 按 loader entry 名请求并核对 client bundle，bundle 头部的
`__ModuleLoader__.load({ id })` 必须注册同名，否则浏览器端报
`loaded without registering "<entry名>"`，整个 GUI 无法启动。包本名安装下
tsdown 默认 ID（`@luoyu_xingu/dsh-multi-root`）即匹配，无需环境变量；
`DSH_PLUGIN_CLIENT_ID` 仅用于换别名时。
更新流程：

1. `pnpm typecheck && pnpm test && pnpm bundle`（默认 ID，无需环境变量）
2. 同步产物到 profile 的自包含目录（只拷 lib 即可，node_modules 不动）：
   `Copy-Item lib\* %USERPROFILE%\.dsh\profiles\web\node_modules\@luoyu_xingu\dsh-multi-root\lib\ -Recurse -Force`
3. **重启 dsh web**（Ctrl+C 后重新运行）——web profile 的 hmr 服务是禁用的，
   文件变更不会热加载；且宿主按启动时的文件哈希校验 bundle rev，文件被替换
   后旧进程会对旧 rev 返回 404，浏览器报 `bundle script ... failed to load`。

移除插件（必须两步都做，缺一即 web 无法启动）：

1. 从 profile `package.json` 的 `bundles` 和 `dependencies` 里删掉
   `@luoyu_xingu/dsh-multi-root`（只删配置不删目录 → 宿主启动报
   `Cannot find package ...`）。
2. 删除 profile 的 `node_modules/@luoyu_xingu/dsh-multi-root` 整目录
   （含其内部 node_modules）。

注意：ESM 模块缓存按「真实路径 URL」钉死，若需热改宿主半区，改完重启
dsh web 即可（无需别名）；hmr.ts 按 `@luoyu_xingu/dsh-multi-root*` 前缀找
自己的 loader 条目，改名时保持前缀即可。

