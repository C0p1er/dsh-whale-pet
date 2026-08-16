# 鲸鱼娘桌宠 · DSH Web 版 🐋

由 **DeepSeek Harness 真实工作状态驱动**的 Agent 伴侣桌宠，运行在 DSH Web 界面右下角。
任务完成播放提示音、需要确认时播放确认音；支持拖动、右键设置菜单；**页面刷新后自动恢复**。

本项目是官方 `dsh-dafeiyu`（大肥鱼）桌宠的 Web 移植版：复用同一份角色素材与状态机设计，
把「Windows 桌面原生窗口」替换为「DSH Web 页面内的小部件」。

## 功能

| 状态 | 动作 | 触发事件 |
| --- | --- | --- |
| 空闲 IDLE | 待机（呼吸动画，随机眨眼/环顾） | 无任务时 |
| 思考 THINKING | 思考姿势 | `turn/start`、`assistant/chunk`、`tool/result` 后 |
| 工作 WORKING | 扫地 / 走动（按工具类型区分） | `tool/call` |
| 等待 WAITING | 说话姿势 | `turn/end` reason=blocked |
| 完成 SUCCESS | 开心跳跃 + 完成提示音 | 任务完成（final answer） |
| 出错 ERROR | 生气 / 眩晕 | `tool/result` 带 error、`turn/end` 异常 |

- **提示音体系**：
  - 完成提示音：仅在 Agent 给出 final answer（`turn/end(completed)`）时响**一次**；
    有目标（goal）的会话仅在目标 `complete` 时响一次；
  - 确认提示音：`turn/end(blocked)`（等待确认/选择）与 `approval/request`（权限申请）时响；
  - 每个脉冲携带自增 `seq`，浏览器端只在新脉冲到达时播放一次，杜绝重复响铃。
- **气泡**：仅执行任务时显示一行状态文案，频率受活跃程度冷却期控制；空闲时不弹窗。
- **窗口适配**：位置绑定窗口边缘（右/下偏移），窗口缩放自动跟随；窗口过小时自动缩小宠物保证完整可见。
- **设置**（右键菜单，localStorage 持久化）：提示音开关、音量、透明度、活跃程度（微动作频率 + 气泡冷却期）、角色大小、复位位置、隐藏宠物。

## 架构

- **Host 端**（`pet-plugin.host.js`，动态 Cordis 插件）：
  - 监听 `session/event`（global）与 `session/disposed`，事件类型：`turn/start`、`step/start`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`todo/write`、`goal/change`、`turn/end`；
  - 状态归约器移植自 `dsh-dafeiyu/src/companion-reducer.js`（含中文文案）；
  - 通过 `webServer` 暴露 `/plugins/dsh-pet/state.json`（状态快照）与 `/plugins/dsh-pet/assets/*`（PNG/MP3 原始字节）；
  - 通过 `tapIndex` 把 `pet-widget.js` 注入每次 index.html 响应。
- **页面小部件**（`pet-widget.js`）：纯原生 JS，不依赖框架/槽位；轮询状态接口渲染动画；
  设置存 `localStorage`；页面刷新后自动恢复。

## 安装（DSH 动态插件）

在 DSH 会话中：

1. 使用 `cordis_define` 定义插件（`code.host` 为 `pet-plugin.host.js` 内容）；
2. 使用 `cordis_run` 激活；
3. 刷新 Web 页面一次（注入脚本生效），右下角出现鲸鱼娘；
4. 之后任意刷新都会自动恢复。

> 素材根目录与 `pet-widget.js` 路径在 Host 端 `ASSET_ROOT` / `WIDGET_PATH` 常量中配置。

## 文件说明

```
pet-plugin.host.js    Host 端插件源码（状态机 + HTTP 路由 + 页面注入）
pet-widget.js         页面级小部件（渲染、动画、提示音、右键设置菜单）
assets/
  pet/                角色动作帧（50 张 PNG，见 ASSET_LICENSE.md）
  finished.mp3        完成提示音
  interrupt.mp3       确认提示音
  pet-manifest.json   动画清单（帧表/帧间隔/动作映射）
ASSET_LICENSE.md      角色视觉素材许可声明（素材不在 MIT 范围内）
LICENSE               MIT（仅代码）
```

## 许可

- **代码**：MIT（本项目代码基于 MIT 许可的 `dsh-dafeiyu` 移植，见 `LICENSE`）；
- **角色视觉素材**：`assets/pet/` 下的 PNG 帧为粉丝二创素材，**不适用 MIT 代码许可**，来源与使用边界见 `ASSET_LICENSE.md`；
- **音频**：`finished.mp3` / `interrupt.mp3` 为项目自备素材。

本项目为粉丝非官方项目，与 DeepSeek 无隶属或背书关系；相关名称、标志与角色权益归其各自所有者。
