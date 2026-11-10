> 2026-11-10 线上状态：新用户级 Token 已通过 D1 列表、元数据及查询验证；迁移、后端、Cron、VAPID 与前端已上线。鉴权、CORS、DeepSeek 实际对话及推送配置检查通过。[独立线上复验](https://github.com/Aero-FUGE/my-personal-assistant/actions/runs/42847699866)成功，验证了 manifest、推送 Service Worker、所有新图标内容及后端 D1 读取。首次发布任务最后因部署切换时资源未及时传播而标红；独立复验已确认上线结果，资源检查现有只读重试。**尚未做 iPhone 真机通知送达验收。**

> 自动发布入口：现有 **Deploy private DeepSeek backend** 增加 `release` 操作，自动验证 D1、迁移、部署后端、首次配置 VAPID、部署前端并做在线检查。已有三项应用 Secrets 和完整 VAPID 均保留；不完整配置会停止。专用 `release/stage2-20261110` 分支的推送可调用同一工作流，普通 main 推送不触发此发布。线上结果以实际 Actions 运行摘要为准。

# 第二阶段：后台推送部署与 iPhone 验收

本阶段代码实现 Web Push，不使用页面定时器作为后台提醒机制。**代码测试不等于真机验收**：必须完成下面的 Cloudflare 配置和部署，再由 iPhone 实际接收系统通知。本次未开通付费套餐或新建数据库；使用用户已创建的 D1。原有 DEEPSEEK_API_KEY、APP_PASSWORD、SESSION_SECRET 保留，仅在 Worker 首次新增 VAPID Secrets。

## 架构、数据与费用

复用现有独立 API Worker `my-personal-assistant-api`。前端是 `my-personal-assistant`，地址为 https://my-personal-assistant.2563247782.workers.dev 。这两个 Worker 不要混用。后端配置的 ALLOWED_ORIGIN 已更新为该前端来源（不含路径和末尾斜线）。前端设置中仍填写原来成功连接的 **API Worker 地址**，不能把前端地址填作 AI 后端。

- D1：保存每台设备的订阅端点、订阅加密公钥、应用地址、时区、同步版本，以及有时间的未完成任务/提醒的 ID、标题、UTC 时间、定位路由、投递状态。不会同步完整项目、聊天、任务备注，也不是跨设备任务数据库。
- Cron：每分钟运行一次，由服务器查询 D1、发送加密 Web Push。PWA 关闭后不再依赖浏览器执行代码。一次最多处理 5 个到期事项，多余事项下一分钟继续，避免超出 Worker 查询额度。
- Service Worker：接收 push 后调用系统 showNotification；点击通知打开任务编辑窗口或对应提醒。任务仅在创建它的浏览器存储中存在，清除本地数据后无法定位旧任务。
- 时间：同步时把本地时间转换成 UTC，并记录 IANA 时区。首次同步后缓存原本时间的 UTC 解释，旅行后不会把同一提醒重新解释为新的时区。旧数据首次同步按当前设备时区解释，请先确认手机时区正确。新改期按改期时设备时区解释。首次同步已经逾期的事项标记 expired，不补发。
- 免费版 D1 包含免费存储、读写额度，Worker/Cron 受所在套餐请求、CPU 和查询限制。私人低频使用通常很小，但同账号其他应用也共享额度。免费版超过每日 D1 限额会拒绝查询，提醒可能中断；付费账号可能产生超量费用。部署前在控制台确认自己的套餐和账单，不需要为本实现升级套餐。

官方依据：[D1 费用](https://developers.cloudflare.com/d1/platform/pricing/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[Cron 配置](https://developers.cloudflare.com/workers/configuration/cron-triggers/)、[Apple 主屏幕 Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)。Cron 配置传播可能需要约 15 分钟，不是部署完成后立即生效。

## Cloudflare 必须手动配置

以下命令在仓库根目录执行，使用您自己的 Cloudflare 登录环境。不要把命令输出中的账号信息、口令或密钥粘贴到聊天。

1. Cloudflare 控制台 → 存储与数据库 → D1 → 创建数据库 `my-personal-assistant-db`，或运行：

   ```sh
   npx wrangler d1 create my-personal-assistant-db --config backend/wrangler.jsonc
   ```

2. 复制新数据库的 UUID，将 [后端配置](../backend/wrangler.jsonc) 中的 `REPLACE_WITH_D1_DATABASE_ID` 替换为真实 ID。ID 不是秘密，可以提交到 GitHub。绑定名必须为 `PUSH_DB`。如使用 GitHub 部署，请给原 Cloudflare API Token 增加该账号的 D1 Edit 权限，不必更换原有应用 Secrets。

3. 初始化 D1 表（可重复执行，不会清空已有数据）：

   ```sh
   npm run push:migrate
   ```

   如终端未配置 Cloudflare 凭据，可复用已有 GitHub Actions Secrets：先将更新后的工作流、D1 配置及迁移文件提交并推送到 GitHub 默认分支，再打开 Actions → **Deploy private DeepSeek backend** → **Run workflow**，将 `operation` 选择为 **migrate**。这只运行测试和 D1 远程迁移，不部署 Worker，不修改 Secrets。展开 **Apply remote D1 migrations (PUSH_DB)** 查看结果；成功后运行摘要会注明迁移成功，已执行的迁移会跳过。默认 `deploy` 不运行迁移；需要二者一起执行时才选 `migrate-and-deploy`。

   如报告鉴权或授权错误（例如 7403），请在 Cloudflare 编辑原 Token，添加 **Account → D1 → Edit**，账号范围包含此数据库所属账号，并保留原 Workers 部署权限。既有 Worker 部署成功不能证明具备 D1 写权限。本工作流不会修改 GitHub 或 Cloudflare Secrets。

4. 生成一次 VAPID 密钥，脚本不会向终端输出密钥，不会覆盖已有文件：

   ```sh
   npm run push:keys
   npx wrangler secret put VAPID_PUBLIC_KEY --config backend/wrangler.jsonc < backend/.vapid/public-key.txt
   npx wrangler secret put VAPID_PRIVATE_KEY --config backend/wrangler.jsonc < backend/.vapid/private-key.txt
   npx wrangler secret put VAPID_SUBJECT --config backend/wrangler.jsonc
   ```

   最后一项在提示后输入您自己的 `mailto:真实联系邮箱`，或有效联系 HTTPS 地址。VAPID 公钥允许提供给浏览器，私钥只能留在 Worker Secret。私钥文件位于被忽略的 `backend/.vapid/`，请安全备份；不要提交、公开或把内容加入任何 `VITE_*`。无需 Apple 开发者账号，也不需要 APNs 证书。以后不要随意换这对密钥，否则已有手机需要更新订阅。

5. 保留原来的 `DEEPSEEK_API_KEY`、`APP_PASSWORD`、`SESSION_SECRET`，本次不重新写入。部署后端：

   ```sh
   npm run backend:deploy
   ```

   GitHub 等价方式：提交包含真实 D1 ID 的代码后，Actions → **Deploy private DeepSeek backend** → Run workflow。工作流默认仅部署，不再覆盖原有三个 Secrets；如需先迁移再部署，手动把 `operation` 选为 `migrate-and-deploy`。VAPID Secrets 事先在 Cloudflare 配好即可，GitHub 不必新增 VAPID 私钥。控制台确认 D1 绑定和 `* * * * *` Cron 存在，等待 Cron 传播完成。

6. 部署前端（根路径，不使用 GitHub Pages 的仓库子路径）：

   ```sh
   npm run frontend:deploy
   ```

   GitHub 等价方式：Actions → **Deploy Cloudflare frontend** → Run workflow，复用原 Cloudflare Token 和 Account ID。配置见 [前端 Worker 配置](../wrangler.frontend.jsonc)。旧 GitHub Pages 工作流仍保留，但它不会更新这个 Cloudflare 域名。若您已有 Cloudflare 自动构建方式，也可以继续运行 `npm run build`、发布 `dist`，确保 `VITE_BASE_PATH=/`。

## iPhone 验收（必须实际执行）

1. 先在旧应用“数据与设置”导出 JSON 备份。域名切换会切换浏览器存储，不要清除网站数据；如数据在旧 GitHub Pages 域名，先在那里导出，再在当前域名导入。
2. 从主屏幕打开当前 Cloudflare 域名的 PWA，iOS 16.4 或更新版本。在应用有更新提示时，先保存编辑，再点更新。
3. 数据与设置 → 用原有 API Worker 地址和私人访问口令连接后端。原口令不变。
4. 后台通知 → 点击“开启通知 / 更新订阅” → 系统弹窗选择允许。通知申请必须来自主动点击，页面加载不申请权限。等待“云端提醒已同步”。默认提醒全部有时间的任务和提醒，每项一次；可把通知频率设为最多每 15 分钟或每小时一条（后续提醒顺延，超过一天不再补发）；可改为仅提醒中心，或关闭后台通知。
5. 点击“发送测试通知”。确认收到的是 iPhone 系统通知。按钮提示仅表示推送服务接收请求，不代表手机已送达。检查 iPhone 通知设置、专注模式、通知摘要和网络。
6. 对律说“**两分钟后提醒我喝水**”。确认显示已保存提醒，并且“云端提醒已同步”。随后切换其他 App 或关闭 PWA，到时间查看系统通知。每分钟 Cron 可能增加约一分钟延迟；系统和网络也可能进一步延迟。点击通知应打开喝水提醒的编辑窗口。
7. 再建一项两分钟后的任务，改成五分钟后；同步成功后确认旧时间不再推送，新时间收到。分别测试完成、删除和通知范围变更。已交给推送服务的在途通知无法撤回，接近触发瞬间操作存在竞态。
8. 拒绝权限时应显示操作提示，任务、项目和聊天仍可使用。拒绝后去系统设置允许，再返回更新订阅。订阅失效、设备重装或 VAPID 换钥也需重新开启；不能在后台偷偷申请权限。

## 状态、可靠性和安全边界

- 本地保存和云端同步是两个结果。所有任务/提醒表变化由 Dexie liveQuery 监听，包含自然语言操作、手动操作、删除、恢复、延后和备份导入；提交成功后再同步。离线保存不丢数据，但旧云端安排直到同步成功才取消或改期。联网、回到前台、重新连接及“立即同步提醒”都会重试。页面关闭后不能替未同步修改补发请求。
- API 沿用私人会话、严格 Origin、输入校验和限流。订阅端点仅允许 Apple、Google、Mozilla、Windows 推送服务，防止任意地址请求。无需将口令、API Key 或 VAPID 私钥交给前端。客户端短期会话仍为原来的 sessionStorage，有效期 24 小时；会话到期不会停止已经保存的服务器提醒，但新增/改期需要重新登录同步。
- 云端用单调版本保护同步、D1 原子 batch 更新和原子发送占位；重复 Cron 不重发同一版本。未改变的提醒重复同步也不会重置 sent 状态。确定性提交失败、网络超时或发送中进程终止不自动重投，优先避免重复；可能留下 failed/sending 并漏发。更改提醒时间可创建新版本。Web Push 没有手机送达回执，因此不能声称“保证送达”。
- 404/410 推送端点失效会禁用设备；回到应用需要更新订阅。设置中可点击“查看云端投递记录”查看 pending/sent/failed/sending/expired 的数量。测试通知与到期通知共用加密发送通道，分别有通知 tag。
- 云端是每设备独立提醒副本，不自动覆盖另一设备。清除网站存储、改域名或退出旧安装前，应先关闭后台通知，以删除旧设备云端副本；否则旧订阅可能暂时继续投递。导出备份不包含订阅身份或时间解释缓存。
- 锁屏通知包含任务/提醒标题，是否在锁屏显示内容由 iPhone 通知预览设置控制。
- 图标从原始最终 PNG 等比例完整缩放为 192、512 和 180 像素，另生成 favicon；原人物未重新设计。manifest 图标 purpose 为 any，避免 maskable 自动裁切关键内容。仓库没有 Windows 桌面封装配置。重新安装前备份并关闭旧订阅；从 Safari 当前域名重新“添加到主屏幕”可更新 iOS 缓存图标。

## 实现后的验证记录

- `npm test`：62 项通过，包含实际 Miniflare D1 SQL、并发防重、订阅删除、改期、过期处理、15 分钟频率限制、Web Push 加密、本地快照同步及 Service Worker 事件。
- `npm run backend:check`、`npm run build`、`npm run backend:dry-run`：通过。后端 dry-run 仅本地打包，没有上传或创建远程资源。
- Chromium 与 WebKit 全量手机界面回归：20 项通过；包括离线、备份、任务/项目、AI 工具执行和拒绝通知不影响其他功能。
- 最终通知专项：Chromium、WebKit 均通过拒绝权限与频率设置持久化检查；最终 AI 专项两浏览器也通过。
- 图标检查：192×192、512×512、Apple 180×180，已目视核对人物完整比例。

真实 Cloudflare Cron、Apple 推送服务、iPhone 关闭应用送达和 DeepSeek 生产模型行为必须部署后再验收，不能用本地模拟代替。
