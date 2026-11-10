> 第二阶段后台推送：实现与部署说明见 [后台通知配置和 iPhone 验收](docs/stage2-push.md)。当前生产前端使用 Cloudflare 域名；下文 GitHub Pages 和“仅应用内提醒”的旧阶段记录不代表本次部署方式或推送能力。新增推送需要手动配置 D1、VAPID 并部署前后端。

# 我的特助

面向 iPhone 的中文私人生活与事业管理 PWA。React + TypeScript + Vite + React Router（HashRouter）+ Dexie / IndexedDB。默认是可离线使用的本地管理工具，对话为**明确标识的 Mock 规则服务**。现已提供独立 Cloudflare Worker 与 DeepSeek 工具调用流程，需自行配置后端 Secrets 后启用；真实模型尚待配置联调。前端不接收或保存 DeepSeek API Key。

## 本地运行

需要 Node.js 22.12+（推荐 Node.js 22 LTS）。

```bash
npm install
npm run dev
```

```bash
npm test                 # 数据、规则、迁移与备份测试
npm run build            # TypeScript 检查 + 生产构建 + PWA
npm run preview          # 预览生产版及离线缓存
npx playwright install --with-deps chromium webkit
npm run test:e2e         # 先执行 build，再执行浏览器验收
```

开发服务器不启用 Service Worker。离线能力应在生产预览或部署后验证。浏览器测试使用独立上下文，不会操作您日常使用的浏览器数据。

## GitHub Pages 启用

1. 将项目代码和 lockfile 提交并推送到 `main` 分支。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions** 中查看 “Deploy PWA to GitHub Pages”。工作流自动安装依赖、测试、构建并部署；也可使用 Run workflow 手动运行。
4. 若仓库设置对 `github-pages` environment 有审批要求，按仓库规则批准部署。
5. 打开部署任务输出的 Pages 地址。项目站点通常为 `https://<用户名>.github.io/<仓库名>/`。

工作流从 `actions/configure-pages` 取得 `base_path`，传给 Vite 的 `VITE_BASE_PATH`，同时兼容仓库子路径和根域名站点。manifest 的 start_url、scope 和图标使用相对路径，Service Worker 由 PWA 插件生成。HashRouter 的地址例如 `/<仓库名>/#/projects`，刷新无需服务器重写规则。

手工构建仓库子路径版本：

```bash
VITE_BASE_PATH=/my-personal-assistant/ npm run build
```

本仓库前端已部署到 https://aero-fuge.github.io/my-personal-assistant/ 。复制本项目到新仓库时，仍需按上述步骤启用 Pages。DeepSeek 后端独立部署，不由 Pages 托管。

## iPhone 使用

用 Safari 打开部署地址 → 分享 → 添加到主屏幕。首次联网打开以缓存静态资源，然后可离线查看和编辑本地数据。适配竖屏、底部安全区域、动态视口与 320 / 390 / 430px 宽度；输入框使用 16px 移动端字体以避免 Safari 自动放大。

使用网页语音输入取决于浏览器实现和麦克风权限；不支持时可用 iPhone 键盘听写。没有持续录音。应用内提醒只在访问页面、打开应用时检查，不保证后台运行或关闭应用后的定时推送。

Playwright Chromium 手机模拟与 WebKit 测试不能替代实际 iPhone 验收。上线后仍应在真机检查主屏幕安装、键盘遮挡、切后台恢复、离线启动及系统存储清理行为。

## 已实现的实际功能

- 今日首页：紫金书房全屏背景、透明角色立绘、动态问候对话框与唯一首要事项；保留顶部提醒／设置、聊天入口及原有底部导航。首页不再展示统计、重复任务、时间安排或项目卡片。
- 任务：创建、编辑、描述、三种状态、优先级、截止时间、预计分钟、所属项目、完成时间、备注、完成与恢复、明日延期、删除、搜索与筛选。
- 项目：创建与编辑、阶段、关联任务、按完成数统计进度、最新更新时间、倒序日志、下一步行动、暂停与恢复。
- 对话：首页直接交谈与完整聊天页共享会话。默认本地规则模式保留；可连接安全后端启用 DeepSeek，让模型返回任务、项目、日志、提醒、记忆与计划的结构化操作。本地校验、风险确认、事务保存、错误回滚与可检查结果均已实现，真实 API 连通仍需配置后验证。
- 日程：日期选择、时间安排、保存执行顺序、优先级调整、编辑与延期、过期未完成任务重新安排。
- 生活：个人事项、习惯每日打卡与累计天数、生活提醒入口。
- 饮食：保存偏好、维护餐食与标签、按名称/标签筛选、随机推荐、选择历史。偏好目前用于保存展示，**不会被 Mock 自动理解成饮食约束**，请用筛选关键词控制候选。
- 提醒：创建、编辑、完成与恢复、删除、稍后 30 分钟、到期状态。
- 数据：导出 JSON、20 MB 导入上限、版本/类型/枚举/时间/重复 ID/关键关联校验、导入预览确认、原子替换、失败回滚、授权记忆的查看修改删除、持久存储许可申请。
- PWA：manifest、独立图标、iOS 主屏幕图标、离线静态资源缓存、新版本可用时提示用户更新。

空数据库不自动注入假任务或伪造项目进度。先创建您的项目和任务，再开始使用。

## 结构与扩展

- `src/data.ts`：类型模型、Dexie 版本、TaskService / ProjectService / MemoryService / ReminderService、备份校验与事务。
- `src/ai.ts`：本地 Mock 协议与旧版候选的原子确认。
- `src/backend-client.ts` / `src/remote-chat.ts` / `shared/ai-contract.ts`：云端会话客户端、白名单结构化协议、真实事务执行与确认。
- `backend/worker.ts` / `backend/wrangler.jsonc`：后端密钥代理、私人签名会话、CORS、限流与 DeepSeek 工具调用。
- `src/components.tsx`：AppShell、CharacterDisplay、DialogueBox、GameButton、GamePanel、TaskCard、ProjectCard、StatusBadge、BottomNavigation、ReminderCard、SectionHeader。
- `src/App.tsx`：各业务页面、编辑表单、路由。
- `src/styles.css`：统一主题变量、组件布局与移动端样式。
- `public/assets/ui/`：backgrounds、buttons、panels、dialogue、navigation、icons、decorations、characters 八类目录，保留用于后续 PNG 美术包。
- `.github/workflows/deploy.yml`：Pages 自动构建与部署。

文字和按钮均为 HTML，首页已使用用户提供的透明角色 PNG 与分层美术组件，没有将页面截图作为 UI。后续可继续替换组件背景或采用适当切片，业务逻辑无需改变。美术资源通过 `import.meta.env.BASE_URL` 拼接路径，避免子路径部署资源丢失。

## 数据与升级策略

数据库版本 1 包含 tasks、projects、projectLogs、conversations、messages、reminders、preferences、memories、dailyPlans；版本 2 增加 habits、meals、mealChoices，并在升级事务中写入 schemaVersion。迁移测试覆盖 v1 → v2，原任务保留。后续升级应增加新的 `db.version(n)`，在 upgrade 事务内补字段并保留旧数据，不删除旧 schema 声明。

备份格式为 `{ version: 2, exportedAt, data: { ...全部表数组 } }`。导入替换全部表，不做不透明合并；仅支持当前版本，旧备份需要先提供显式转换器。校验通过后由用户最终确认，Dexie 事务确保整体成功或整体回滚。

数据仅在当前设备和浏览器中保存。Safari 页面和主屏幕应用的存储行为由系统决定，不承诺共享；不同设备不会自动同步。清除站点数据、移除应用或系统存储回收均可能影响数据，应定期导出。备份包含私人信息，请自行妥善保管。

## 待配置与后续能力

DeepSeek 接入代码与安全后端已实现，实际后端部署、真实密钥配置和模型联调尚待完成。账户与跨设备同步、服务端 Web Push、额外角色表情、全量知识检索及后台自动规划尚未实现。当前 AI 可根据概要提出日程建议并在确认后保存已有任务的排序。

现有 Worker 负责认证、限流、服务端密钥、请求大小限制和结构化响应校验，前端执行器负责操作风险检查。前端只请求同一业务协议，不接收 DeepSeek Key。模糊/高影响操作仍须展示可检查的候选，确认后才能落库；不可让模型直接任意写数据库。推送需要单独的服务端调度与订阅体系，不能由 GitHub Pages 代替。

## 依赖审计

已升级测试工具以消除初始高危/严重问题。当前 npm 审计仍报告 PWA 构建链中 deepmerge、glob、minimatch 及其依赖方共 5 项低/中风险，`npm audit fix` 目前未解决；这些属于开发/构建依赖，不包含在运行时业务包中。不要给构建链提供不可信插件或构建输入。后续升级 Workbox/PWA 构建链时应重新审计并执行全部测试。

## 初始阶段验收记录（历史）

- `npm install` 成功；`npm run build` 成功生成生产包与离线缓存。
- `npm test`：10 项业务测试通过，包括迁移、备份校验、确认操作的幂等与失败回滚。
- 仓库子路径 `/my-personal-assistant/` 生产构建通过，Chromium / WebKit 共 6 项端到端测试通过：项目任务、对话确认与恢复、习惯、饮食、提醒、记忆、JSON 往返恢复、PWA 资源与离线访问。
- 手机宽度检查覆盖 320、390、430px；尚未进行物理 iPhone 真机验收。

子路径浏览器验收命令：

```bash
VITE_BASE_PATH=/my-personal-assistant/ npm run build
PLAYWRIGHT_BASE_PATH=/my-personal-assistant npm run test:e2e
```

## 首页第一阶段结构改造

首页结构使用 `src/home.tsx`，独立样式为 `src/home.css`；`src/App.tsx` 的 Today 负责订阅真实 IndexedDB 数据并调用原有 TaskService。没有接入图片、改变数据库模型或修改其他页面的业务逻辑。

`src/home-task.ts` 只负责首页展示选择：进行中优先，其次从今天、逾期与未排期待办中按优先级、截止时间选择一项；同条件以创建时间和 ID 保持稳定。未来日期的待办继续在任务管理中展示。首页“延期到明天”通过现有保存接口设为明日 18:00 的待办，再重新选取；公共延期服务不变。完成、编辑和开始执行后通过 Dexie 响应式订阅更新，其他任务不会被删除。

本轮验收：生产构建通过，15 项单元／业务测试及 Chromium、WebKit 共 10 项端到端测试通过。新增测试覆盖首要事项选取、执行状态、延期与完成后的重选、刷新恢复、全部任务保留、320／390／430px 长标题与底部操作可达性、全部导航入口。尚未接入最终美术，尚未进行物理 iPhone 真机验收。

## 首页美术安装

现已接入仓库提供的书房、人物、对话框、任务框及按钮合集。源图未改动；按钮和面板切片由无损裁切脚本生成。首页专属 shell 负责全视口背景和导航配色，其他页面不应用该主题。详细尺寸、透明度、裁切说明及修改范围见 [美术安装验收](./docs/home-art-installation.md)。可查看 [390px 首页截图](./docs/home-390.png) 和 [390px 任务操作区截图](./docs/home-task-390.png)。

## 第一轮首页精修

立绘展示视窗与对话框已收紧，首要任务主操作前移。空状态可直接新建任务，开始／继续执行会直接打开任务详情表单。常规任务在 320／390／430 × 844px 的首屏均能看到主操作，长内容仍可正常滚动。详见 [精修验收与手机截图](./docs/home-refinement.md)。

## 第二阶段：律的交互与动态书房

首页现为单一对话框，可直接交谈、展开共享历史及通过有限中文指令管理真实任务。书房按本地时间连续插值改变氛围，角色状态接口已建立但仍只有原始立绘。已确认并安装 A 思源宋体，比较页为 `#/font-preview`。详细能力、安全边界、代码入口及截图见 [第二阶段实施验收](./docs/stage2-implementation.md)。

### 已确认的字体与全站书房

A 思源宋体已作为全局本地字体安装，Unicode 分包及 OFL 授权随项目保存。所有页面共享首页的紫金书房背景与动态光照，原有页面布局和本地数据保持。

测试光影：右上角“数据与设置” → “书房光影”，选择时段或调整时间/滑杆，再返回首页或任务等页面。预览不改变任务日期或提醒；点击“恢复真实时间”或刷新即可退出。详细说明见 [字体与光影测试](docs/appearance-and-fonts.md)。

### DeepSeek 安全接入

新增独立 Cloudflare Worker、私人会话登录、结构化任务/项目等工具操作和确认执行。前端默认保持本地规则模式；真实 AI 需要单独部署后端并配置 Secrets。详见 [DeepSeek 部署与验收](docs/deepseek-setup.md)。请勿把 DeepSeek API Key 放进前端、`VITE_*` 或仓库。
