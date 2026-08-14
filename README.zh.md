# dsh-multi-root

DeepSeek Harness Web GUI 的多根工作区插件：给 DSH 挂载多个**独立文件夹**，在侧边栏面板中统一管理，并让 agent 通过受控的宿主侧工具跨所有已登记根目录做列举 / 读取 / 写入 / glob——相当于 VS Code 多根工作区之于 DSH。

所有根一律平等：没有主工作区之分，根集合对所有会话与 agent 全局共享。

以 cordis profile bundle 形式热插拔安装，不改任何 DSH 源码。

## 能力

- 侧边栏入口 `多根`（`Roots`），在中间列打开管理面板。
- 挂载任意数量的文件夹（路径输入或宿主目录浏览器；Windows 上浏览从
  **盘符级**开始——先选 C:、D:… 再逐级进入），可选显示别名。
- 支持重命名、移除、排序；每行显示目录实时状态（可用 / 目录缺失）。
- 根目录持久化在 `~/.dsh/dsh-multi-root.json`（目录 0700、文件 0600、
  原子写入）——GUI 与 agent 共享同一份配置。
- 注册进 DSH 工具链的 agent 工具：

  | 工具 | 用途 |
  | --- | --- |
  | `workspace_roots` | 列出全部已挂载根（id、名称、路径、状态）。 |
  | `workspace_root_list` | 列举某根目录内的一个目录。 |
  | `workspace_root_read` | 读取某根目录内的文本文件（256 KB 上限，截断会报告）。 |
  | `workspace_root_write` | 在某根目录内写入（新建或覆盖）文本文件，自动创建父目录。 |
  | `workspace_root_glob` | 在某根目录内做 glob 匹配（结果有数量上限）。 |

- 系统提示词段落向每个 agent 宣告插件与工具（`announceToAgent: false`
  可关闭；`enabled` 为总开关）。
- 双语界面文案（中 / 英），跟随文档语言。

## 安装

插件是 cordis bundle 包，在 web profile 中激活：

```sh
# 源码 checkout
dsh plugin --profile web add link:<path>/dsh-multi-root

# npm（发布后）
dsh plugin --profile web add @luoyu-xingu/dsh-multi-root
```

`dsh web` 会依据包内 `dsh.client` 声明自动伺服浏览器半区。运行中的
`dsh web` 会热重载 profile patch 层，无需重启；刷新页面即可看到面板。

开发迭代时宿主半区还会监听自身构建产物 `lib/`（`hotReload` 配置，默认开），
重新构建后自动原位重挂载——构建 → 等几秒 → 刷新浏览器，全程无需重启
`dsh web`。

## 使用

1. 点击侧边栏 `多根` 入口。
2. 用路径输入或「浏览」对话框挂载文件夹（Windows 上先选盘符），可给每个
   根起别名。
3. 让 agent 跨文件夹工作——它会用 `workspace_roots` 发现根，再用其余
   `workspace_root_*` 工具在根内操作。

## 安全模型

本插件**有意绕过 DSH 文件沙箱**：其操作以宿主进程权限运行。因此信任边界
就是根目录集合本身，且每次操作都会强制执行：

- 根目录只能是**用户**在 GUI 中挂载的目录；agent 永远不能自行挂载或移除。
- 所有路径以根相对方式拼接，经 `fs.realpath` 规范化，并要求落在已登记根
  目录内部。路径穿越（`..`、绝对路径、盘符）与符号链接逃逸在读取和写入
  （写入还会校验解析后的父目录）时都会被拒绝。
- glob 从不跟随符号链接；后续若用匹配结果做读写，读写门会再次校验。
- 读取上限 256 KB、写入上限 5 MB、列举上限 500 项、glob 结果上限 1000 项——
  模型输出保持有界。
- 所有 `/api/dsh-multi-root/*` 路由仅限 loopback 并带浏览器同源标记，
  LAN 暴露的部署无法访问。
- 配置文件不含密钥，但仍以 0600 权限原子写入。

已知限制：工具以宿主用户权限运行、消耗真实磁盘——覆盖已存在文件前先向用户
确认。目录浏览器会列出宿主目录（这是选择器的数据源，本身仅限 loopback）。

## 配置

宿主插件接受 schemastery 校验的配置（组合入口）：

```yaml
multi-root:
  enabled: true          # 路由、工具、提示词段落的总开关
  announceToAgent: true  # 向 agent 宣告插件的系统提示词段落
  hotReload: true        # 宿主半区监听自身 lib/，构建后原位重挂载
```

## 开发

```sh
pnpm install
pnpm typecheck   # tsc -b（host/client 两个 program）+ 测试 program
pnpm test        # vitest run（store / fs-ops / tools / client 冒烟）
pnpm build       # 声明产物 + tsdown（lib/ 宿主半区 + lib/client.js）
```

结构：`src/index.ts` 为宿主半区（存储、路由、工具、提示词段落），
`src/client/` 为浏览器半区（侧边栏入口、面板），`src/core/` 为共享类型。
客户端 bundle 是面向 GUI `__ModuleLoader__` 的 closure-factory 产物，并带
构建期纯度门（仅平台种子模块可保持 external）。

## License

MIT
