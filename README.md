# AI 划词追问 Chrome 扩展

这是一个适合个人开发者起步的最小版本：

- 在 ChatGPT、Gemini、Kimi 页面框选 AI 回复中的文字。
- 原地显示悬浮追问框。
- 扩展把“选中文字 + 追问”发送给自己的 Express 后端。
- 后端读取服务器环境变量中的 API Key，再调用兼容 OpenAI 格式的 AI 接口。
- 回答直接显示在当前网页，不跳转，也不需要回到页面原输入框。

## 1. 整体架构说明

数据流如下：

```text
用户框选文字
    ↓
Chrome 内容脚本显示悬浮输入框
    ↓
扩展后台 Service Worker 请求你的 Express 后端
    ↓
Express 后端读取服务器上的 API Key
    ↓
后端请求 https://infistar.ai/v1/chat/completions
    ↓
回答按原路线返回，并显示在当前网页的悬浮窗口
```

三部分各自只做一件事：

1. **浏览器扩展**：监听框选、显示界面、收集问题、展示结果。扩展里不保存 AI API Key。
2. **后端代理**：校验输入、限制请求频率、保管 API Key、调用 AI。
3. **AI API**：真正生成回答。当前使用兼容 OpenAI Chat Completions 格式的接口。

这里暂时不需要数据库，因为当前功能没有账号、历史记录、付费额度等需要长期保存的数据。

## 2. 文件目录结构

```text
输入框插件/
├── .gitignore
├── README.md
├── backend/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       └── server.js
└── extension/
    ├── config.js
    ├── content.js
    ├── manifest.json
    └── service-worker.js
```

## 3. 关键代码怎么工作

### `extension/content.js`

它运行在 ChatGPT、Gemini、Kimi 的网页里。鼠标松开后，它读取当前框选的文字，并在选择区域附近显示输入框。

提交问题时，内容脚本使用 `chrome.runtime.sendMessage` 把数据交给扩展后台。回答通过 `textContent` 显示，不把 AI 返回值当 HTML 执行，这可以降低脚本注入风险。

### `extension/service-worker.js`

它是扩展的后台。它接收内容脚本的数据，再请求 Express 后端。把网络请求放在这里，可以让网页内脚本保持简单，也能通过 Manifest 中的 `host_permissions` 明确限制后端地址。

### `backend/src/server.js`

它只接受必要字段，限制选中文字和问题的长度，然后使用服务器环境变量中的 API Key 请求 Infistar。

后端还包含：

- 请求体大小限制；
- 基于 IP 的简单限流；
- 可配置的扩展来源限制；
- 上游请求超时；
- 不向浏览器暴露上游 API 的详细错误和密钥。

## 4. 环境变量说明

复制 `backend/.env.example` 为 `backend/.env` 后填写：

- `INFISTAR_API_KEY`：后端调用 AI 的密钥，只能保存在服务器。
- `INFISTAR_BASE_URL`：AI 接口地址，默认是 `https://infistar.ai/v1`。
- `INFISTAR_MODEL`：使用的模型名称。必须按 Infistar 控制台提供的模型名填写，代码中没有写死。
- `PORT`：Express 后端监听端口，默认 `3000`。
- `NODE_ENV`：运行环境。本地使用 `development`，线上必须使用 `production`。生产模式下如果没有配置允许来源，后端会拒绝请求。
- `ALLOWED_EXTENSION_ORIGINS`：允许访问代理的扩展来源，多个值用英文逗号分隔，例如 `chrome-extension://abcdefghijklmnop...`。本地开发可暂时留空。
- `TRUST_PROXY`：可信反向代理层数。本地或直接运行 Node 时为 `0`；部署在一层可信云代理后面时通常为 `1`。应按托管平台文档设置，否则 IP 限流可能不准确。
- `RATE_LIMIT_WINDOW_MS`：限流时间窗口，默认 60 秒。
- `RATE_LIMIT_MAX`：每个 IP 在一个时间窗口内最多请求次数，默认 20 次。
- `UPSTREAM_TIMEOUT_MS`：等待 AI 接口返回的最长时间，默认 45 秒。

## 5. 本地运行步骤

### 第一步：安装 Node.js

安装 Node.js 20 或更高版本。然后在终端进入后端目录：

```bash
cd backend
npm install
```

### 第二步：配置 `.env`

```bash
cp .env.example .env
```

打开 `backend/.env`，至少填写：

```dotenv
INFISTAR_API_KEY=你的真实密钥
INFISTAR_MODEL=Infistar支持的模型名称
```

### 第三步：启动后端

```bash
npm run dev
```

看到 `Backend listening on http://localhost:3000` 就表示启动成功。

可以用浏览器打开 `http://localhost:3000/health`，应看到：

```json
{"ok":true}
```

### 第四步：加载 Chrome 扩展

1. 打开 Chrome，在地址栏输入 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `extension` 文件夹。
5. 打开 ChatGPT、Gemini 或 Kimi 页面并刷新一次。
6. 框选一段文字，输入追问，点击“追问”。

如果修改过扩展代码，需要回到 `chrome://extensions` 点击扩展卡片上的刷新按钮，再刷新目标网页。

## 6. 部署后端后要修改哪里

把 `extension/config.js` 中的本地地址改成你的 HTTPS 后端地址：

```js
globalThis.APP_CONFIG = Object.freeze({
  backendUrl: "https://api.example.com/api/ask",
});
```

同时把 `extension/manifest.json` 中：

```json
"http://localhost:3000/*"
```

改为：

```json
"https://api.example.com/*"
```

公开发布只能使用 HTTPS 后端。修改后重新加载扩展。

扩展发布到 Chrome Web Store 后，会得到固定扩展 ID。把下面的来源写入服务器的 `ALLOWED_EXTENSION_ORIGINS`：

```dotenv
NODE_ENV=production
ALLOWED_EXTENSION_ORIGINS=chrome-extension://你的扩展ID
```

## 7. 安全风险说明

### 为什么 API Key 不能放在扩展里

Chrome 扩展安装包可以被用户下载和查看。即使把 Key 混淆、拆开或压缩，别人仍然可以找到它。Key 一旦泄露，别人就能消耗你的额度，甚至导致账号被封。

因此 API Key 必须只存在于后端服务器的环境变量里。

### 后端代理可能被滥用

只要有人知道代理地址，就可能绕过扩展直接请求它，消耗你的 AI 额度。当前版本有基础 IP 限流和来源检查，但这些不是强身份认证。

公开发布且用户量增长后，至少应加入一种真正可撤销、可计数的鉴权方式，例如：

- 每次安装获取一个短期访问令牌；
- 用户登录后获得访问令牌；
- 由后端记录每个用户或安装实例的每日额度。

做到这些时通常才需要数据库。不要把一个固定“代理密码”写进扩展，因为扩展内的固定密码同样可以被提取。

### CORS 风险

CORS 只是浏览器访问规则，不是防攻击防火墙。`Access-Control-Allow-Origin: *` 会让任何网页更容易调用你的代理，不适合公开部署。

本项目可通过 `ALLOWED_EXTENSION_ORIGINS` 限制浏览器来源。攻击者仍可能伪造 HTTP 请求，因此还需要限流、额度和正式鉴权。

### 隐私风险

用户框选的文字、问题、当前页面标题和网址会发送到你的后端及 AI 服务。发布前要准备清晰的隐私政策，并说明收集什么、为什么收集、保存多久。本项目后端不保存这些内容，也不把问题打印到日志。

## 8. 部署前必须检查清单

- [ ] `backend/.env` 没有上传到 GitHub。
- [ ] API Key 只存在于服务器环境变量中。
- [ ] 线上后端使用 HTTPS。
- [ ] `ALLOWED_EXTENSION_ORIGINS` 已设置为正式扩展 ID。
- [ ] `NODE_ENV` 已设置为 `production`。
- [ ] `TRUST_PROXY` 已按照部署平台文档设置。
- [ ] 后端已配置基础限流，并根据实际费用调低额度。
- [ ] 已考虑加入可撤销的用户或安装级鉴权。
- [ ] 已给云服务设置费用上限和账单告警。
- [ ] `manifest.json` 只包含真正需要的网站和后端权限。
- [ ] 已删除本地 `http://localhost:3000/*` 权限。
- [ ] 已准备隐私政策，说明框选内容会发送给第三方 AI。
- [ ] 已在 ChatGPT、Gemini、Kimi 最新网页上分别测试。
- [ ] 上游错误、超时、后端离线时，界面都有可理解的提示。

## 9. 当前方案有意保持简单

这个版本没有数据库、登录系统、Docker、Redis、队列和支付。它适合本地验证产品是否好用。

当扩展准备面向陌生用户公开使用、需要为每个人分配额度时，才有必要增加数据库和登录或安装令牌。那一步是为了控制真实费用，而不是为了让架构看起来更完整。
