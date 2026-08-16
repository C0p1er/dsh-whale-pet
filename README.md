# DSH 桌宠（大肥鱼）· Web 版插件

把官方 `dsh-dafeiyu`（大肥鱼）桌宠移植到 DSH Web 界面右下角：
由 DSH Agent 的**真实工作事件**驱动动作，任务完成时播放提示音。
**页面刷新后桌宠自动恢复**（页面级小部件，由 Host 注入 index.html）。

## 效果

- 右下角悬浮显示大肥鱼（透明 PNG，来自 `DSH桌宠.tar`，形象原封未动）。
- 随 Agent 状态切换动作：
  | 状态 | 动作 | 触发事件 |
  | --- | --- | --- |
  | 空闲 IDLE | 待机（呼吸动画，随机眨眼/环顾） | 无任务时 |
  | 思考 THINKING | 思考姿势 | `turn/start`、`assistant/chunk`、`tool/result` 后 |
  | 工作 WORKING | 扫地 / 走动（按工具类型区分搜索、命令等） | `tool/call`（搜索→左右走、命令→右向走、编辑/测试→扫地） |
  | 等待 WAITING | 说话姿势 | `turn/end` reason=blocked |
  | 完成 SUCCESS | 开心跳跃 + **播放提示音** | 任务真正完成（见下方规则） |
  | 出错 ERROR | 生气 / 眩晕 | `tool/result` 带 error、`turn/end` 异常 |
- 状态气泡显示：当前文案、项目名、真实待办进度（已完成 x/y 步）。
- 多 Session 时按优先级展示：等待确认 > 出错 > 工作 > 思考 > 空闲。
- 互动：**按住拖动** 换位置；**右键** 打开设置菜单（菜单位置自动适应屏幕边缘，
  宠物靠近屏幕边缘时自动翻转方向，保证菜单完整显示）。
- **固定画布尺寸**（238×260，`object-fit: contain`）：所有动作帧的像素尺寸不同
  （实测宽 168~223px 不等），渲染时统一在固定画布内等比例容纳，任何动作切换宠物大小都不变。
- **左键点击互动**：单击随机触发 摸头 / 戳一戳 / 摇尾巴（排除生气与眩晕剪辑）；
  1.5 秒内连续点击 5 次则触发生气（愤怒表情，短暂停留后恢复）。

## 提示音体系（v8）

| 提示音 | 触发时机 | 音频 |
| --- | --- | --- |
| **完成提示音** | **final answer 时刻，每个任务完成仅响一次**：无目标会话在每轮 `turn/end(completed)`（Agent 给出最终答复）时响一次；有目标会话仅在目标 `complete` 时响一次 | `finished sound.mp3`（来自 音频素材 目录） |
| **确认提示音** | 需要权限/做选择：`approval/asked` 会话事件（审批弹窗出现，主通道）与 `turn/end(blocked)`（Agent 等待确认）；`approval/request` 为冗余通道 | `interruption sound.mp3` |

- **仅响一次**：每个脉冲携带自增 `seq`，浏览器只在新脉冲到达时播放一次——修复了「回合结束后残留脉冲随每个事件（回合开始/思考块/工具结果）反复重播」的 bug；
- 竞态保护：带提示音的脉冲未过期前，不会被紧随其后的静音脉冲覆盖，保证提示音一定触发；
- 浏览器自动播放策略通过首次点击解锁（`pointerdown` 时 `unlockAudio()`），未解锁时的待播提示音会在解锁后立即补播。

## 设置（右键菜单，localStorage 持久化）

右键点击桌宠打开设置菜单：

| 设置项 | 范围 | 说明 |
| --- | --- | --- |
| 提示音 | 开 / 关 | 完成提示音与确认提示音总开关 |
| 提示音量 | 0–100% | 两种提示音共用的音量 |
| 透明度 | 30–100% | 桌宠整体透明度 |
| 活跃程度 | 安静 / 标准 / 活泼 | 控制微动作频率与气泡弹出频率（见下方） |
| 角色大小 | 60–160% | 桌宠缩放（叠加窗口自适应缩放） |
| 复位位置 | — | 回到默认的右下角边缘位置 |
| 隐藏宠物 | — | 隐藏后右下角出现 🐟 恢复按钮 |

窗口缩小到宠物无法完整显示时自动等比缩小（最小 20%），始终完整可见。

## 活跃程度

| 模式 | 微动作间隔 | 气泡显示时长 | 气泡冷却 |
| --- | --- | --- | --- |
| 安静 | 9–17 秒 | 5.0 秒 | 18 秒 |
| 标准 | 3–8 秒 | 3.6 秒 | 10 秒 |
| 活泼 | 1–4 秒 | 2.6 秒 | 6 秒 |

- 空闲时不弹气泡、不做微动作以外的打扰；
- 气泡只显示单行状态文案，冷却期内状态变化只原位更新内容，不重新弹出。

## 运行方式

1. 把本仓库放入 DSH 插件目录（含 `pet-plugin.host.js` 与 `assets/`）。
2. 修改 `pet-plugin.host.js` 顶部 `ASSET_ROOT` 指向本地素材目录（或直接用仓库内 `assets/`）。
3. 启动 DSH Web 后桌宠自动出现在右下角；刷新页面依然保留。

## 架构

- `pet-plugin.host.js` | Host 半区：监听 `session/event` / `session/disposed`（`{global:true}`），
  用 CompanionReducer 归约出桌面宠物状态，通过 `/plugins/dsh-pet/state.json` 暴露；
  素材路由 `/plugins/dsh-pet/assets/*` 原样输出 PNG/MP3；`tapIndex` 注入小部件脚本。
- `pet-widget.js` | 页面级小部件：桌宠渲染、动画、互动、右键设置菜单、提示音（注入 index.html）。

### 状态归约（CompanionReducer）

- `turn/start` → THINKING；`assistant/*` 无工具时保持 THINKING；
- `tool/call` → WORKING（按工具名归约为 searching/editing/testing/commanding）；
- `tool/result` 带 error → ERROR 脉冲（`dizzy:true` → 眩晕剪辑），无错误则回到 THINKING；
- `todo/write` → 更新气泡里的真实进度（已完成 x/y 步）；
- `approval/asked` → WAITING + 确认提示音（等待批准）；
- `turn/end` → completed → SUCCESS 脉冲；blocked → WAITING + 确认提示音；aborted → IDLE；error/max-tokens → ERROR；
- `goal/change` → 有目标会话在目标 complete 时响完成音（此时 `turn/end` 静音，保证每任务只响一次）。
- 多 Session 优先级：WAITING(60) > ERROR(50) > WORKING(30) > THINKING(20) > IDLE(0)，同优先级按最近更新。

### 技术要点

- 页面级小部件 + `tapIndex` 注入：桌宠不依赖动态插件 Client 半区挂载，**刷新页面自动恢复**；
- `webServer.register` 路由 + `fs.readBytes` 读素材，Host 端字节缓存；小部件脚本不缓存（热更新）；
- 提示音仅当脉冲 `sound=true` 且开关开启时播放；浏览器自动播放策略通过首次点击解锁；
- 设置存 `localStorage`，右键菜单实时生效；时钟用页面原生 `setInterval/setTimeout`（页面上下文允许）；
- 位置存右/下边缘偏移量（非绝对坐标）：窗口缩放时宠物自动跟随窗口边缘，不会被挤出视口；
- 窗口过小时按视口等比缩放（宽 ≤ 35% 视口、高 ≤ 50% 视口，最小 20%）。

## 素材许可

PNG 形象来自官方 `DSH桌宠.tar`，仅作个人/学习用途的移植展示；音频来自 音频素材 目录。
详见 `ASSET_LICENSE.md`。

## 已知限制

- 官方版的 DSH 设置页配置、位置持久化等桌面专属能力由右键菜单 + localStorage 替代。
