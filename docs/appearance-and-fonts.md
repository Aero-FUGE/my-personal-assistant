# 字体与书房光影

已采用 A 思源宋体，标题、对话、任务内容、按钮与输入控件统一使用本地字体。数字可搭配西文衬线字体。字体来自 Adobe 官方 Source Han Serif SC Regular，按 Unicode 范围生成 WOFF2 分包，保留全部原字体 cmap 字符覆盖；不在原字体中的字符由系统字体回退。优先加载界面文字与 GB2312 一级常用汉字的小分包；PWA 预缓存这些常用分包。其余字符按需加载并缓存，首次离线遇到尚未缓存的生僻字时使用系统字体回退，避免首次安装下载全部字库。

遵守 SIL OFL 1.1：改名为 AssistantSerif，保留版权与许可证。详见 [OFL](../public/assets/fonts/OFL.txt)。可用 [构建脚本](../scripts/prepare-ui-font.py) 重新生成，然后运行 [常用字优化脚本](../scripts/prepare-common-font.py)，需要 Python fonttools 与 brotli。仅使用 Regular 原文件，粗体由浏览器合成。

## 在手机测试

1. 打开右上角设置，找到“书房光影”。
2. 选择清晨 06:00、正午 12:00、黄昏 18:30、夜晚 21:00 或深夜 01:00。
3. 返回“今日”，或切换任务、项目、日程、生活、特助页面，预览状态保持一致。
4. 用时间输入或滑杆查看任意分钟。17:00 与 17:01 差异很小，17:00 与 18:00 较明显。23:59 到 00:00 使用同一组跨午夜插值。
5. 点击页面上方“恢复真实时间”，或设置中“跟随真实时间”。刷新也会退出预览。

预览使用独立 React 状态，仅影响 CSS 光照变量，不写入数据库，不修改任务日期、提醒、问候使用的时间或系统时钟。预览快速过渡约 250ms；真实模式每分钟更新并以 60 秒平滑过渡。页面隐藏时停止定时更新，恢复前台即同步；减少动态效果偏好下取消过渡。

所有页面共用 AppShell 的全视口背景及光照层，保留各页面的内容内边距、卡片、导航及功能。背景按 cover 保持比例裁切，不拦截触摸。字体 CSS 使用相对字体路径，入口使用 Vite BASE_URL，支持仓库子路径。

光照是基于原始书房图的 CSS 氛围模拟，不能真正改变窗外景色或点亮原画灯具；人物仅轻微改变环境亮度。iPhone 软件键盘和实际 PWA 安全区域仍建议在真机检查。

## 本轮代码入口

- [appearance.tsx](../src/appearance.tsx)：设置中的时段预览、时间输入、滑杆和共享预览状态。
- [components.tsx](../src/components.tsx)、[home-background.css](../src/home-background.css)：全站独立背景层、导航配色、预览状态条，保留首页单独的内容布局规则。
- [room-light.ts](../src/room-light.ts)：真实时间更新与独立光照预览时间。
- [typography.css](../src/typography.css)、[home.css](../src/home.css)、[字体资源](../public/assets/fonts/)：全局正式字体和首页语义字体引用。
- [App.tsx](../src/App.tsx)：设置页挂载外观控件；[font-preview.tsx](../src/font-preview.tsx)：已确认字体的对照说明。
- [index.html](../index.html)、[vite.config.ts](../vite.config.ts)：BASE_URL 字体入口、紫色安装主题、常用字体预缓存与其余字体按需缓存。
- [appearance.spec.ts](../tests/appearance.spec.ts)：所有主页面、三种手机宽度、连续插值预览、正式字体加载与截图；原有长流程的测试总时限调整为 60 秒，各断言仍保留原等待时限。

未改动数据库模型、任务服务、聊天服务、用户数据或原画。

## 手机截图

- [390px 正午首页](study-home-noon-390.png)
- [390px 深夜首页](study-home-night-390.png)
- [390px 深夜任务页](study-tasks-night-390.png)

常用字包覆盖 3,866 个字符（含实际界面文案），4 个 WOFF2 共约 1.9 MB；其余 Unicode 分包保留原字体 44,779 个码位覆盖。原字体没有的字符使用系统回退。正式字体分包中的内部名称和 CFF 名称均改为 AssistantSerif，版权及 OFL 许可保留。

## 验收结果

- `npm run build` 成功；PWA 预缓存约 11.8 MiB，未将全部生僻字分包加入首次安装。
- `npm test`：31 项通过。
- `npm run test:e2e`：Chromium / WebKit 共 16 项通过，包括真实任务、共享聊天、数据恢复、离线、字体和全站背景。
- 仓库子路径 `/my-personal-assistant/` 下的字体、光照预览及背景专项：两个浏览器共 2 项通过。
- 320 / 390 / 430px 无横向溢出，背景全视口 cover；390px 正午、深夜及任务页截图已生成。
- 本轮使用浏览器模拟验收，未执行物理 iPhone PWA、原生键盘与耗电测试。
