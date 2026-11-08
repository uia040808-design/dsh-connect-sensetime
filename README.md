# dsh-connect-sensetime

把本机已登录的 **商汤小浣熊（SenseTime Raccoon）** 桌面客户端接进 **DSH（DeepSeek Harness）**：左栏面板里看积分和模型目录，同时暴露一个 OpenAI 兼容端点，让 DSH 的「自定义模型 API」直接发现并调用小浣熊的模型。

> 非官方集成。只使用当前机器上你自己的登录态和积分，不共享凭据、不绕过计费。

## 功能

- **左栏入口 + 面板**：登录账户、token 类型与到期时间、可用积分、模型目录（倍率、计费状态、上下文窗口、是否支持图片）。
- **输入框积分胶囊**：输入时随时看到剩余积分，点一下回到面板。
- **三路连通性探测**：模型目录 / 积分 / 一次最小对话，逐项给出结论与可执行的错误提示。
- **OpenAI 兼容端点**：`GET /v1/models`、`POST /v1/chat/completions`、`GET /v1/health`；SSE 流式与 `tools` / `tool_calls` 原样透传，`vision` 模型的 `image_url`（base64 data URL）直接可用。
- **固定端口**：桌面版 DSH 每次启动都会换 Web 端口，插件额外在 `127.0.0.1:8787` 起一个稳定的 OpenAI 端点，重启后 Base URL 不用改。
- **登录态只读**：token 只在 DSH 的 Host 进程内使用，浏览器只接触插件在本机生成的 key。

## 界面

| 位置 | 槽位 | 作用 |
| --- | --- | --- |
| 左栏入口 | `sidebar.panellist`（`id: raccoon`，order 20） | 图标 + 名称，点击打开面板 |
| 面板 | `main`（`key: raccoon`） | 积分、模型目录、计费状态、三项探测、接入配置（Base URL + 本地 Key） |
| 输入框胶囊 | `conversation.input.right`（`id: raccoon-credits`，order 30） | 显示可用积分，点击返回面板 |

## 工作原理

```
小浣熊桌面客户端 ──登录──▶ auth.json（只读，token 留在本机）
                                │
DSH Host：@local/dsh-raccoon ◀──┘  读取 token，仅在本进程内使用
  ├─ /raccoon/api/state | probe | config ──▶ 面板 / 胶囊 / 连通性探测
  ├─ /raccoon/v1/{models,chat/completions,health} ──▶ 挂在 Harness Web 服务上的端点
  └─ http://127.0.0.1:8787/v1 ──▶ DSH「自定义模型 API」的稳定 Base URL
                                │
                                └── HTTPS ──▶ xiaohuanxiong.com（模型目录 / 积分 / 对话）
```

没有第二个进程：面板路由挂在 Harness 的 Web 服务上，只有固定端口代理是一个额外的 loopback 监听器。

## 安装

### 前置条件

| 依赖 | 说明 |
| --- | --- |
| Windows 10/11 | 登录态按 Windows 客户端路径读取；macOS / Linux 未验证 |
| 小浣熊桌面客户端 | 已安装并登录（`%USERPROFILE%\.box-agent\config\auth.json` 存在） |
| DSH 桌面版 | 在 0.2.2-rc.1 上开发；插件依赖 Harness 的 `webServer` 与 client UI 槽位 |
| pnpm | 仅用于安装 profile 依赖；DSH 自带的 pnpm 也能完成 |

> 仓库名 `dsh-connect-sensetime` 是 GitHub 上的仓库名，插件包名仍是 `@local/dsh-raccoon`，不发布到 npm。安装有两种方式：**一键从 GitHub 安装**（推荐给普通用户），或 `link:` 本地源码（要改代码时用）。

### 一键安装（推荐）

前提：终端里能直接运行 `dsh`（`dsh -V` 输出版本号；桌面版一般随附 CLI，没有可 `npm i -g @deepseek-ai/dsh`）。

```powershell
dsh plugin --profile desktop add github:uia040808-design/dsh-connect-sensetime
```

`dsh plugin` 会一次做完三件事：

1. 把插件装进 profile 的 `node_modules`（包名 `@local/dsh-raccoon`）；
2. 在 profile 的 `package.json` 里登记 `"@local/dsh-raccoon": "github:uia040808-design/dsh-connect-sensetime"`；
3. 自动把 `@local/dsh-raccoon` 追加进该 profile 的 `dsh.profile.bundles` —— 不用手改 JSON。

装完重启 DSH 即可。profile 名不是 `desktop`（例如 `web`）时，把 `--profile desktop` 换成你自己的。

更新与卸载：

```powershell
# 更新到 main 的最新提交（若没变化，先 remove 再 add 一次）
pnpm --dir "$env:USERPROFILE\.dsh\profiles\desktop" update @local/dsh-raccoon

# 卸载（同时从 dsh.profile.bundles 里摘掉）
dsh plugin --profile desktop remove @local/dsh-raccoon
```

> 从 GitHub 安装需要能访问 `codeload.github.com`，慢网络下可能要 1–2 分钟；`dsh plugin` 使用 PATH 上的 `pnpm`。仓库里没有需要编译的代码，所以不会触发 pnpm 的构建审批提示。

### 手动安装（本地开发，需要改源码时）

1. 克隆到 DSH 的插件目录：

   ```powershell
   $dst = Join-Path $env:USERPROFILE '.dsh\plugin-sources\dsh-raccoon'
   git clone https://github.com/uia040808-design/dsh-connect-sensetime.git $dst
   ```

2. 让 profile 的 `package.json`（桌面版默认 `%USERPROFILE%\.dsh\profiles\desktop\package.json`）用 `link:` 指向这份源码，并在 `dsh.profile.bundles` 里登记：

   ```json
   {
     "dependencies": {
       "@local/dsh-raccoon": "link:C:/Users/<你的用户名>/.dsh/plugin-sources/dsh-raccoon"
     },
     "dsh": {
       "profile": {
         "bundles": ["@deepseek-ai/dsh-base", "...", "@local/dsh-raccoon"]
       }
     }
   }
   ```

   `link:` 路径用正斜杠（JSON 字符串里的反斜杠需要转义）。保留文件里原有的依赖与 bundles 条目，只把 `@local/dsh-raccoon` 加进去。

3. 安装依赖并重启 DSH：

   ```powershell
   cd "$env:USERPROFILE\.dsh\profiles\desktop"
   pnpm install
   ```

   重启后，左栏应出现「小浣熊接入」。没有出现时，先看宿主日志里有没有 `[raccoon]` 开头的行。

### 把模型接进 DSH

1. 打开面板 → **接入配置**，复制 Base URL（默认 `http://127.0.0.1:8787/v1`）和 API Key（`rcc_` 开头）。
2. DSH → 设置 → 模型 → 添加模型提供商 → **自定义模型 API**。
3. Provider ID 填 `raccoon`，协议选 **OpenAI Chat Completions**，粘贴 Base URL 与 API Key。
4. 点「获取可用模型」，勾选要用的模型，保存。
5. 新建对话时选择 `sn-*` 模型即可。模型名里的 `· x<倍率>` 是计费倍率提示，不参与模型 ID。

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `RACCOON_PROXY_HOST` | `127.0.0.1` | 固定端口代理的监听地址 |
| `RACCOON_PROXY_PORT` | `8787` | 固定端口代理的端口；改端口后记得同步改 Base URL |
| `RACCOON_API_BASE` | `https://xiaohuanxiong.com/api/web/llm/v2` | 上游 OpenAI 兼容 base |
| `RACCOON_POINTS_URL` | `https://xiaohuanxiong.com/api/web/points/v1/balance` | 积分接口 |
| `RACCOON_ORG_CODE` | 空 | 企业账号的组织码；个人账号不需要 |

本地 API Key 保存在 `$DSH_HOME/raccoon-connect/secret.json`（默认 `%USERPROFILE%\.dsh\raccoon-connect\secret.json`），首次使用时自动生成。

## HTTP 接口

面板路由挂在 Harness Web 服务上（端口随 DSH 每次启动变化）：

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/raccoon/api/state` | GET | 登录状态、积分、模型目录、端点描述；`?refresh=1` 绕过 20 秒缓存 |
| `/raccoon/api/probe?target=catalog\|credits\|chat` | GET | 单项连通性探测；`chat` 会发一次最小对话，消耗少量积分 |
| `/raccoon/api/config` | GET | 端点值，含本地生成的 API Key |
| `/raccoon/v1/models` | GET | OpenAI 风格模型列表，供「获取可用模型」使用 |
| `/raccoon/v1/chat/completions` | POST | 流式透传到 `xiaohuanxiong.com`，包含 `tools` 与 `tool_calls` |
| `/raccoon/v1/health` | GET | 本地 key 与上游登录态的轻量检查 |

固定端口代理（默认 `127.0.0.1:8787`，需要 `Authorization: Bearer <本地 Key>`）：

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/v1/models` | GET | 模型列表 |
| `/v1/chat/completions` | POST | 流式对话透传 |
| `/v1/health` | GET | 登录态检查 |
| `/health` | GET | 同 `/v1/health` |

## 隐私与安全

- 登录态从 `%USERPROFILE%\.box-agent\config\auth.json` **只读**读取，插件从不写入该文件，也不落盘 token。
- access token 只存在于 Host 进程内；浏览器只通过 `/raccoon/*` 与本地生成的 key 交互（`timingSafeEqual` 校验）。
- 请求只发往 `xiaohuanxiong.com`（可用上面的环境变量覆盖）。
- 不记录 `Authorization`、请求体、响应体；上游失败时只回传状态码和截断到 400 字符的错误详情。
- 对话请求体与 SSE 响应都是原样透传，插件不解析、不改写。

## 已知限制与风险

- 小浣熊下发的 IAM token 没有 refresh 授权：过期后需要打开客户端重新登录，面板会给出这条提示而不是裸 401。
- 上游接口、模型清单、计费倍率都可能变化；模型目录有 20 秒缓存，变动时刷新面板或加 `?refresh=1`。
- 「测试对话」探测会真实消耗少量积分。
- 只在 Windows 桌面版 DSH 上验证过；企业账号（`X-Org-Code`）路径已实现但未实测。
- 非官方集成，使用前请自行评估账号与合规风险。

## 目录结构

```
.
├─ index.js                  # Host 半：登录态读取、面板路由、固定端口代理
├─ client.js                 # Web UI 半：左栏入口、面板、积分胶囊
├─ cordis.patch.yml          # bundle 补丁：把插件插入 Harness
├─ package.json              # @local/dsh-raccoon
├─ locale/{zh,en}.json       # 界面文案
├─ icon.svg                  # 左栏图标
└─ tools/asar.mjs            # 从 Electron app.asar 里列出 / 提取文件的小工具
```

## 开发与调试

- 插件以 `link:` 方式安装，改完 `index.js` / `client.js` 后重启 DSH；客户端资源有缓存，必要时刷新窗口。
- 查看状态：`curl http://127.0.0.1:<DSH Web 端口>/raccoon/api/state`
- 直接验证端点：

  ```powershell
  $key = (Get-Content "$env:USERPROFILE\.dsh\raccoon-connect\secret.json" -Raw | ConvertFrom-Json).key
  curl.exe -s http://127.0.0.1:8787/v1/models -H "Authorization: Bearer $key"
  ```

- 分析小浣熊客户端（Electron）：

  ```powershell
  $env:ASAR_PATH = 'D:\app\raccoon-ai\resources\app.asar'
  node tools/asar.mjs list 'llm|auth|points'
  node tools/asar.mjs get package.json out.json
  ```

## 免责声明

本项目是非官方的本地桥接，与小浣熊（商汤科技）和 DeepSeek 官方均无关联。它不修改客户端、不绕过计费、不共享任何凭据；所有请求都以你本机的登录身份发往官方接口。使用产生的一切后果（包括账号风险）由使用者自行承担。

## License

[MIT](LICENSE)

## English

A **DSH** (DeepSeek Harness) bundle plugin that connects the locally signed-in **SenseTime Raccoon** desktop client to DSH. It adds a sidebar panel with credits and the model catalog, plus an OpenAI-compatible endpoint on `http://127.0.0.1:8787/v1` so Raccoon models can be used through DSH's custom model API.

- Login state is read read-only from `%USERPROFILE%\.box-agent\config\auth.json`; the token never leaves the Host process.
- Streaming SSE, `tools`/`tool_calls`, and vision `image_url` (base64 data URL) are passed through unchanged.
- Windows only (Windows client layout); macOS/Linux are untested. Install steps are in the Chinese sections above.

MIT licensed. Unofficial project, not affiliated with SenseTime or DeepSeek.
