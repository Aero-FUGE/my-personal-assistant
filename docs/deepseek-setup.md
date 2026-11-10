# DeepSeek 安全接入与验收

## 当前状态

前端、Cloudflare Worker 安全代理、工具操作执行器和测试已经实现。未提供 Cloudflare 部署凭据和真实 DeepSeek Key，因此不能声称已完成真实模型联调。GitHub Pages 继续托管前端；Worker 是独立后端。前端默认继续本地 Mock 规则模式。

## 第一次部署：不必把 Key 发送给开发助手

1. 注册/登录 [Cloudflare](https://dash.cloudflare.com/)，取得 Account ID，创建可编辑此账号 Workers 的 API Token。
2. 在 [DeepSeek 平台](https://platform.deepseek.com/) 创建 API Key，确认可用余额。生产模型名由后端 `DEEPSEEK_MODEL` 配置，当前按官方接口使用 `deepseek-flash`，关闭思考模式后调用固定的 `assistant_plan` 工具。
3. 打开 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，添加：

| 名称                    | 内容                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Worker 部署专用 Token                                       |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID                                       |
| `DEEPSEEK_API_KEY`      | DeepSeek Key，只供后端 Secrets 使用                         |
| `APP_PASSWORD`          | 自己创建的独立私人访问口令，至少16字符，勿复用 DeepSeek Key |
| `SESSION_SECRET`        | 随机签名密钥，至少32字符，和上面的口令不同                  |

可在自己终端运行 `openssl rand -hex 32` 生成随机签名密钥。不要将任何真实值写进仓库、聊天、截图或 `VITE_*` 环境变量。

4. GitHub → Actions → **Deploy private DeepSeek backend** → Run workflow。此工作流只手动触发，不会因前端每次更新而改变后端密钥。它先部署 Worker，再从环境变量经标准输入写入 Cloudflare 加密 Secrets，不把密钥放进构建产物。
5. 在 Cloudflare Workers 中打开 `my-personal-assistant-api`，找到实际的 HTTPS `workers.dev` 地址。后端配置中的 `ALLOWED_ORIGIN` 必须为前端来源 **https://aero-fuge.github.io**（不含仓库路径和末尾斜线）；自定义域名时一起修改。
6. 手机打开正式站 → 数据与设置 → 律 · AI 连接，填写 **Worker 根地址** 和 **APP_PASSWORD 私人口令**，确认云端数据说明，点击连接。不要填 DeepSeek API Key。Worker 地址本身不是网页，直接在地址栏打开可能因来源保护显示拒绝访问；请通过正式前端连接。
7. 登录成功只验证后端和口令。先发送“你好”，收到正常 AI 回复，才算真实 DeepSeek 连通。若余额/Key/模型/网络有问题会明确报错，不会暗中退回 Mock。

### 使用 CLI 部署（可选）

在已授权的个人终端运行：

```sh
npm ci
npx wrangler login
npm run backend:check
npm run backend:deploy
npx wrangler secret put DEEPSEEK_API_KEY --config backend/wrangler.jsonc
npx wrangler secret put APP_PASSWORD --config backend/wrangler.jsonc
npx wrangler secret put SESSION_SECRET --config backend/wrangler.jsonc
```

交互提示里输入真实值，勿放入命令参数或提交。仅本地调试时将 [空模板](../backend/.dev.vars.example) 复制为忽略提交的 `backend/.dev.vars`。使用 [Worker 配置](../backend/wrangler.jsonc) 的来源发送测试请求。生产前端只接受 HTTPS 后端。

## 已实现的业务闭环

自然语言 → Worker 携带最近对话及只读业务概要请求 DeepSeek → 强制工具调用返回结构化计划 → 后端和前端双重 Zod 校验 → 本地操作风险检查 → 必要时用户确认 → 单个 Dexie 事务调用已有服务 → 数据库结果读回 → 保存操作结果回复与消息来源。

- 任务：创建、修改标题/描述/优先级/时间/预计耗时/项目/备注、完成、删除。
- 项目：创建、修改阶段/下一步/状态、暂停恢复、记录项目日志。同一批可以新建项目并创建关联任务。
- 提醒：创建、修改、完成、删除，仅应用内提醒。
- 日程：按已有任务保存指定日期的任务排序。新任务应先创建，再安排排序；目前不支持引用同批尚未生成 ID 的新任务来保存计划。
- 记忆：只处理用户明确要求的长期记忆，始终先确认，仍可在设置中查看修改删除。
- 查询与建议：模型结合概要回答今日/指定日期/首要任务、项目最近进展及下一步；最近24条对话帮助继续追问。模型查询不写入数据；复杂回答仍可能有误，应结合任务/项目页面核对。
- 没有操作的回复不会伪造数据库成功结果；实际修改后的回复由本地执行结果生成，不采用模型预先声称的成功文案。

最多每批12项。批量、删除、项目修改、长期记忆、计划覆盖、高优先级任务修改、同名同时间任务、时间冲突都先展示完整操作清单。确认后不再请求模型，执行保存的同一份计划；取消不改原数据。确认前数据已变化或超过24小时会取消；并发请求、重复请求和事务失败不会留下部分项目、部分任务或假成功回复。

## 隐私与安全范围

- DeepSeek Key、私人访问口令原值和签名密钥仅配置后端。前端表单只临时持有私人访问口令以换取会话，随后清空。
- 会话为24小时 HMAC 签名 Bearer token，存 `sessionStorage`，避免依赖 iPhone 拦截的跨站 Cookie；关闭应用后是否保留由浏览器决定，重新连接即可。退出云端只删除本机令牌；若需使所有旧会话立即失效，请更换后端 SESSION_SECRET。
- 地址与模式在本地存储，认证令牌不进入 IndexedDB，不包含在 JSON 备份中。历史消息新增可选 `provider` 字段，不改变数据库版本或索引，旧数据与旧备份兼容。
- 服务端校验确切 Origin、签名、到期时间、内容类型和请求大小。固定 DeepSeek 官方上游，用户无法注入任意转发 URL、system 消息或模型名。
- Cloudflare 限流：登录按来源 IP 每分钟5次；已登录聊天共用私人账号计数每分钟20次。限流按 Cloudflare 地点近似计算，不是严格全球计费上限；模型平台的额度/余额仍需单独管理。
- 上游45秒、前端55秒超时；非白名单工具、无效字段、无效日期、截断响应、请求失败都不会执行本地数据修改。不返回上游原始错误、密钥或思考链。
- 后端不自行保存业务数据库或聊天，关闭 Worker observability；用户选择发送的数据仍会经过 Cloudflare 和 DeepSeek，受其服务条款影响。这不是端到端加密。
- 上下文最多150个任务、50个项目、30条项目日志、30条授权记忆、80条待办提醒、14天计划、24条最近消息，描述有长度限制。数量不足时不能把概要当作完整数据库；超过体积上限会提示新建对话或精简描述。
- 这仍是个人单账号系统，没有多用户账号隔离、跨设备同步、后台定时推送、联网搜索或外部应用操作。

## 验收示例（真实部署后）

1. “明天下午三点帮我安排两小时写歌。” → 任务页出现真实任务；刷新仍存在。
2. “创建一个专辑项目，把写歌、编曲安排为项目任务。” → 先确认，确认后项目及关联任务同时保存。
3. “把刚才那个任务改到后天晚上八点。” → 结合上下文定位；歧义时先问。
4. “删除这个任务。” → 先显示清单；取消后仍存在；再次确认后才删除。
5. “继续上次的项目，告诉我下一步。” → 利用项目阶段、日志和 nextAction 回复。
6. “记住，我喜欢清淡饮食。” → 确认后才出现在授权记忆。
7. 关闭网络或填写错误口令 → 明确报错，不产生假任务，也不冒充模型回复。

## 开发验证

```sh
npm run build
npm test
npm run backend:check
npm run backend:dry-run
npm run test:e2e
```

[代理单元测试](../backend/worker.test.ts)、[事务测试](../src/remote-chat.test.ts) 和 [浏览器接口模拟测试](../tests/ai.spec.ts) 使用测试响应，不能代替真实 DeepSeek 联调。模拟测试会验证真实 IndexedDB 写入、共享历史、关联项目、确认恢复、错误保留输入和三种手机宽度。

协议和安全实现参考官方资料：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)、[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。

## 本轮验证结果

- 前端生产构建与后端 TypeScript 检查通过。
- 49 项业务／协议／代理安全测试通过。
- Chromium / WebKit 共18项浏览器验收通过，其中云端流程使用明确的接口模拟响应；项目与任务仍写入真实测试 IndexedDB。
- Worker `--dry-run` 打包通过，约125 KiB gzip。未部署到真实 Cloudflare 账号，未使用真实 DeepSeek Key 发起模型请求。
- 待用户配置后，必须完成“你好”连通、创建任务、创建关联项目、确认删除、关闭重开恢复等真实验收，才能报告正式 AI 已启用。
