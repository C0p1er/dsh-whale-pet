// DSH 桌宠（大肥鱼）· Host 端 v9
// 职责：监听 DSH Session 事件 → 归约成宠物状态 → 通过 HTTP 暴露给浏览器；
// 同时把桌宠素材（PNG / MP3）以原始字节通过 webServer 路由提供给浏览器，
// 并通过 tapIndex 把页面级小部件 pet-widget.js 注入 index.html ——
// 桌宠随页面常驻，刷新页面后自动恢复（不再依赖动态 Client 半区）。
// v9 变更：
//  - 气泡第二行不再包含项目名（“提示音插件”等目录名不再显示），保留阶段/进度/任务信息；
//  - 小部件侧：窗口缩放（最大化→窗口化）时自动把宠物拉回视口内，修复拖动后宠物在
//    非最大化窗口下消失的问题；气泡弹出增加按活跃程度的冷却期，降低弹窗频率。
// 素材根目录：ASSET_ROOT（可改），来自用户的 DSH桌宠.tar 解包产物与 音频素材 目录。
return {
  apply(ctx) {
    const ASSET_ROOT = 'E:/Deepseek harness/提示音插件/assets/package/assets'
    const WIDGET_PATH = 'E:/Deepseek harness/提示音插件/pet-widget.js'
    const ROUTE_PREFIX = '/plugins/dsh-pet'
    const MAX_BYTES = 500000

    const S = Object.freeze({
      IDLE: 'IDLE',
      THINKING: 'THINKING',
      WORKING: 'WORKING',
      WAITING: 'WAITING',
      SUCCESS: 'SUCCESS',
      ERROR: 'ERROR',
    })

    // ---------------- 文案（移植自 dsh-dafeiyu/status-copy.js） ----------------
    const COPY = Object.freeze({
      idle: ['我在这儿等新任务哦', '现在暂时没任务呢', '大肥鱼正在待命中~'],
      preparing: ['新任务正在梳理中哦~', '让我先看看项目呢', '正在理清接下来要做什么呀'],
      thinking: ['正在认真想下一步呢', '正在梳理思路哦~', '让我整理一下刚才的结果呢'],
      searching: ['正在帮你找相关内容呢', '正在项目里仔细找找哦~', '正在查看相关文件呢'],
      editing: ['这部分正在修改中哦', '正在把改动写进去呢', '正在认真调整实现呢'],
      testing: ['正在认真检查结果呢', '正在跑测试确认一下哦', '正在验证改动有没有问题呢'],
      commanding: ['正在执行项目命令呢', '正在让项目跑起来哦', '正在看看命令执行得怎么样呢'],
      working: ['正在继续处理任务呢', '这一步正在进行中哦', '大肥鱼还在认真干活呢'],
      result: ['正在整理刚才的结果呢', '这一步处理好了，继续看看哦', '正在确认下一步怎么做呢'],
      waiting: ['需要你确认一下后续呢', '这里要等你看一下哦', '轮到你来决定下一步啦'],
      success: ['这次的任务搞定啦~', '这一轮顺利完成啦', '任务完成咯~'],
      toolError: ['这一步好像没跑通呢', '刚才的操作遇到一点问题哦', '这里卡了一下，我再等等你呢'],
      error: ['任务好像遇到一点问题呢', '这里需要回来看看啦', '这次没有顺利跑完呢'],
      stopped: ['任务已经停下来啦', '这次任务先停在这里哦'],
      limit: ['内容有点多，到上限啦', '这次输出已经到上限咯'],
    })

    function seedNumber(seed) {
      const number = Number(seed)
      if (Number.isFinite(number)) return Math.abs(Math.trunc(number))
      let total = 0
      const text = String(seed ?? '')
      for (let index = 0; index < text.length; index += 1) total += text.charCodeAt(index)
      return total
    }

    function statusCopy(group, seed = 0) {
      const variants = COPY[group] || COPY.working
      return variants[seedNumber(seed) % variants.length]
    }

    function activityCopy(activity, seed = 0) {
      return statusCopy({
        searching: 'searching',
        editing: 'editing',
        testing: 'testing',
        commanding: 'commanding',
      }[activity] || 'working', seed)
    }

    function activityStage(activity) {
      return {
        searching: '查找阶段',
        editing: '实现阶段',
        testing: '验证阶段',
        commanding: '执行阶段',
      }[activity] || '处理阶段'
    }

    function taskCopy(task) {
      const value = String(task ?? '').trim().replace(/[。！？.!?]+$/u, '')
      if (!value) return statusCopy('working')
      if (/^(正在|继续)/u.test(value)) return value + '呢'
      if (/^(准备|检查|验证|修改|修复|测试|构建|整理|分析|梳理|查找|搜索|读取|实现)/u.test(value)) return '正在' + value + '呢'
      return '正在处理「' + value + '」呢'
    }

    function toolActivity(name) {
      const value = String(name || '').toLowerCase()
      if (/search|grep|find|glob|web|read|fetch|open/.test(value)) return 'searching'
      if (/write|edit|patch|replace|create|move|delete/.test(value)) return 'editing'
      if (/test|check|lint|build|verify/.test(value)) return 'testing'
      if (/shell|bash|exec|command|terminal|powershell/.test(value)) return 'commanding'
      return 'using-tool'
    }

    const statePriority = Object.freeze({ WAITING: 60, ERROR: 50, WORKING: 30, THINKING: 20, IDLE: 0 })

    // ---------------- 状态归约器（移植自 dsh-dafeiyu/companion-reducer.js） ----------------
    function sessionIdOf(session) {
      return String((session && session.header && session.header.id)
        || (session && session.id) || 'unknown-session')
    }

    function isSubagent(session) {
      return (session && session.header && session.header.origin === 'subagent')
        || Number((session && session.header && session.header.delegationDepth) || 0) > 0
    }

    function cleanProjectName(value) {
      const text = String(value ?? '').trim()
      if (!text) return undefined
      const pathParts = text.split(/[\\/]/u).filter(Boolean)
      const candidate = pathParts.length > 1 ? pathParts[pathParts.length - 1] : text
      return candidate.replace(/\s+/gu, ' ').slice(0, 40) || undefined
    }

    function projectNameOf(session, event) {
      const candidates = []
      if (session && session.header) candidates.push(session.header.title, session.header.name, session.header.cwd)
      if (session) candidates.push(session.title, session.name, session.cwd)
      if (session && session.context) candidates.push(session.context.cwd)
      if (event && event.data) candidates.push(event.data.projectName, event.data.cwd)
      for (const candidate of candidates) {
        const clean = cleanProjectName(candidate)
        if (clean) return clean
      }
      return undefined
    }

    function progressOf(todos) {
      if (!Array.isArray(todos) || todos.length === 0) return undefined
      let completed = 0
      for (const todo of todos) {
        if (todo && (todo.status === 'completed' || todo.status === 'complete' || todo.status === 'done')) completed += 1
      }
      const currentIndex = todos.findIndex((todo) => todo && todo.status === 'in_progress')
      return { completed, total: todos.length, current: currentIndex >= 0 ? currentIndex + 1 : undefined }
    }

    function detailFor(record, stage) {
      // 不包含项目名：气泡第二行不再显示“提示音插件”等目录名
      const parts = []
      if (record.progress && record.progress.total) parts.push('已完成 ' + record.progress.completed + '/' + record.progress.total + ' 步')
      if (record.task) parts.push(record.task)
      else if (stage) parts.push(stage)
      return parts.join(' · ') || stage || 'DSH 任务'
    }

    class CompanionReducer {
      constructor(options) {
        options = options || {}
        this.includeSubagents = options.includeSubagents === true
        this.sessions = new Map()
        this.clock = 0
        this.selectedSessionId = undefined
        this.outputSignature = undefined
      }

      handle(session, event) {
        if (!event || typeof event.type !== 'string') return []
        const subagent = isSubagent(session)
        if (!this.includeSubagents && subagent) return []
        const sessionId = sessionIdOf(session)
        const record = this.record(sessionId)
        record.subagent = subagent
        record.lastSeq = Number(event.seq ?? record.lastSeq)
        record.project = projectNameOf(session, event) || record.project
        switch (event.type) {
          case 'turn/start':
            record.turnActive = true
            record.openTools.clear()
            record.task = undefined
            record.progress = undefined
            this.update(record, S.THINKING, { phase: 'turn-start', stage: '准备阶段', message: statusCopy('preparing', event.seq) })
            return this.render()
          case 'step/start':
          case 'assistant/chunk':
          case 'assistant/message':
            if (!record.turnActive || record.openTools.size > 0) return []
            this.update(record, S.THINKING, { phase: event.type, stage: '分析阶段', message: statusCopy('thinking', event.seq) })
            return this.render()
          case 'tool/call': {
            const callId = String((event.data && event.data.callId) || ('seq-' + String(event.seq || 'unknown')))
            const name = String((event.data && event.data.name) || 'tool')
            const activity = toolActivity(name)
            record.openTools.set(callId, name)
            this.update(record, S.WORKING, {
              phase: 'tool-call',
              activity,
              stage: activityStage(activity),
              toolName: name,
              message: activityCopy(activity, event.seq),
            })
            return this.render()
          }
          case 'tool/result':
            return this.toolResult(record, event)
          case 'todo/write':
            return this.todo(record, event)
          case 'approval/asked': {
            // 审批请求（权限/选择弹窗出现）→ 响「确认」提示音
            // 走 session/event 通道（approval/request host 事件作用域不可靠）
            const data = event.data || {}
            const toolName = String(data.toolName || 'tool')
            this.update(record, S.WAITING, { phase: 'approval-asked', stage: '等待确认', toolName, message: statusCopy('waiting', event.seq) })
            const rendered = this.render()
            const selection = this.select()
            this.remember(selection)
            return rendered.concat([{
              kind: 'pulse',
              state: S.WAITING,
              sound: 'interrupt',
              ttlMs: 3000,
              phase: 'approval-asked',
              message: statusCopy('waiting', event.seq),
              detail: '需要批准：' + toolName,
            }])
          }
          case 'goal/change': {
            const data = event.data || {}
            const operation = String(data.operation || '')
            record.hasGoal = operation !== 'clear'
            // 任务真正完成：目标被标记 complete 时响「完成」提示音
            if (operation !== 'complete') return []
            const selection = this.select()
            if (selection.record.state === S.WAITING || selection.record.state === S.ERROR) return this.render(selection)
            this.remember(selection)
            return [{
              kind: 'pulse',
              state: S.SUCCESS,
              sound: 'completion',
              ttlMs: 2600,
              phase: 'goal-complete',
              message: statusCopy('success', event.seq),
              detail: detailFor(record, '任务已完成'),
            }]
          }
          case 'turn/end':
            return this.turnEnd(record, event)
          default:
            return []
        }
      }

      disposeSession(session) {
        const sessionId = sessionIdOf(session)
        if (!this.sessions.delete(sessionId)) return []
        return this.render()
      }

      toolResult(record, event) {
        const message = event.data && event.data.message
        const block = message && message.content && message.content[0]
        const callId = String((block && block.toolCallId)
          || (message && message.callId)
          || (event.data && event.data.callId) || '')
        if (callId) record.openTools.delete(callId)
        const next = record.openTools.size > 0 ? S.WORKING : S.THINKING
        const nextActivity = next === S.WORKING ? toolActivity(record.openTools.values().next().value) : undefined
        this.update(record, next, {
          phase: 'tool-result',
          activity: nextActivity,
          stage: next === S.WORKING ? activityStage(nextActivity) : '整理阶段',
          message: next === S.WORKING ? activityCopy(nextActivity, event.seq) : statusCopy('result', event.seq),
        })
        if (!event.data || !event.data.error) return this.render()
        const selection = this.select()
        if (selection.record.state === S.WAITING || selection.record.state === S.ERROR) return this.render(selection)
        this.remember(selection)
        return [{
          kind: 'pulse',
          state: S.ERROR,
          // 工具调用失败 → 眩晕（dizzy 剪辑），更贴合「被工具结果砸晕」的情绪
          dizzy: true,
          ttlMs: 1800,
          resumeState: selection.record.state,
          message: statusCopy('toolError', event.seq),
          detail: detailFor(record),
          errorCode: event.data.error.code,
        }]
      }

      todo(record, event) {
        const todos = Array.isArray(event.data && event.data.todos) ? event.data.todos : []
        let current
        for (const todo of todos) { if (todo && todo.status === 'in_progress') { current = todo; break } }
        if (!current) { for (const todo of todos) { if (todo && todo.status === 'pending') { current = todo; break } } }
        const progress = progressOf(todos)
        if (!(current && current.content) && !progress) return []
        const nextTask = current && current.content ? String(current.content) : record.task
        const unchanged = nextTask === record.task
          && (progress ? progress.completed : undefined) === (record.progress ? record.progress.completed : undefined)
          && (progress ? progress.total : undefined) === (record.progress ? record.progress.total : undefined)
        if (unchanged) return []
        record.task = nextTask
        record.progress = progress
        record.updatedAt = ++this.clock
        const selection = this.select()
        if (selection.record.id !== record.id) return this.render(selection)
        return [{
          kind: 'task',
          task: record.task,
          progress: record.progress,
          project: record.project,
          message: taskCopy(record.task),
          detail: detailFor(record, '执行阶段'),
        }]
      }

      turnEnd(record, event) {
        record.turnActive = false
        record.openTools.clear()
        const kind = String((event.data && event.data.reason && event.data.reason.kind) || 'completed')
        if (kind === 'blocked') {
          // Agent 等待用户确认/选择 → 响「确认」提示音
          this.update(record, S.WAITING, { phase: 'turn-end', stage: '等待确认', message: statusCopy('waiting', event.seq) })
          const rendered = this.render()
          const selection = this.select()
          this.remember(selection)
          return rendered.concat([{
            kind: 'pulse',
            state: S.WAITING,
            sound: 'interrupt',
            ttlMs: 2500,
            phase: 'turn-end',
            message: statusCopy('waiting', event.seq),
            detail: detailFor(record, '等待确认'),
          }])
        }
        if (kind === 'aborted') {
          this.update(record, S.IDLE, { phase: 'turn-end', stage: '已停止', message: statusCopy('stopped', event.seq) })
          return this.render()
        }
        if (kind !== 'completed') {
          this.update(record, S.ERROR, {
            phase: 'turn-end',
            stage: '需要处理',
            reasonKind: kind,
            message: kind === 'max-tokens' ? statusCopy('limit', event.seq) : statusCopy('error', event.seq),
          })
          return this.render()
        }
        this.update(record, S.IDLE, { phase: 'turn-end', stage: '已完成', message: statusCopy('idle', event.seq) })
        const selection = this.select()
        if (selection.record.state === S.WAITING || selection.record.state === S.ERROR) return this.render(selection)
        this.remember(selection)
        return [{
          kind: 'pulse',
          state: S.SUCCESS,
          // v8：final answer 时刻——
          //  - 有目标的任务：只在目标 complete 时响（此处静音，防每轮响）；
          //  - 无目标会话：每轮 turn/end(completed) 即 Agent 给出最终答复，响一次完成音
          sound: record.hasGoal !== true ? 'completion' : null,
          ttlMs: 2200,
          phase: 'turn-end',
          message: statusCopy('success', event.seq),
          detail: detailFor(record, '本轮已完成'),
        }]
      }

      record(sessionId) {
        let entry = this.sessions.get(sessionId)
        if (entry) return entry
        entry = {
          id: sessionId,
          state: S.IDLE,
          payload: { phase: 'session-created', message: 'DSH 空闲中' },
          turnActive: false,
          openTools: new Map(),
          task: undefined,
          progress: undefined,
          project: undefined,
          subagent: false,
          hasGoal: false,
          lastSeq: -1,
          updatedAt: ++this.clock,
        }
        this.sessions.set(sessionId, entry)
        return entry
      }

      update(record, state, payload) {
        record.state = state
        record.payload = payload
        record.updatedAt = ++this.clock
      }

      select() {
        const records = [...this.sessions.values()]
        if (records.length === 0) {
          return {
            record: {
              id: 'dsh-host',
              state: S.IDLE,
              payload: { phase: 'no-session', message: 'DSH 空闲中' },
              updatedAt: ++this.clock,
            },
          }
        }
        records.sort((left, right) => {
          const priority = (statePriority[right.state] || 0) - (statePriority[left.state] || 0)
          if (priority !== 0) return priority
          const recency = right.updatedAt - left.updatedAt
          if (recency !== 0) return recency
          return left.id.localeCompare(right.id)
        })
        return { record: records[0] }
      }

      render(selection) {
        selection = selection || this.select()
        const signature = this.signature(selection.record)
        if (signature === this.outputSignature) return []
        this.remember(selection)
        const record = selection.record
        return [{
          kind: 'state',
          state: record.state,
          activity: record.payload.activity,
          toolName: record.payload.toolName,
          message: record.payload.message,
          detail: detailFor(record),
          project: record.project,
          task: record.task,
          progress: record.progress,
        }]
      }

      remember(selection) {
        this.selectedSessionId = selection.record.id
        this.outputSignature = this.signature(selection.record)
      }

      signature(record) {
        return [
          record.id,
          record.state,
          record.payload.activity || '',
          record.payload.toolName || '',
          record.payload.message || '',
          record.project || '',
          record.task || '',
          (record.progress && record.progress.completed) || '',
          (record.progress && record.progress.total) || '',
        ].join('|')
      }
    }

    // ---------------- 运行状态快照 ----------------
    const reducer = new CompanionReducer()
    let rev = 0
    let base = {
      state: S.IDLE,
      activity: undefined,
      message: statusCopy('idle', 0),
      detail: 'DSH · 等待下一次任务',
      project: undefined,
      task: undefined,
      progress: undefined,
    }
    let pulse = null
    let pulseSeq = 0
    // 诊断：确认音触发计数（定位「做选择/要权限时不响」问题）
    let interruptCount = 0
    let lastInterruptAt = null
    let lastInterruptSource = null

    function emitInterrupt(source, message, detail, ttlMs) {
      // 触发计数在 fold 中统一统计（blocked 与 approval 两条路径共用）
      fold([{
        kind: 'pulse',
        state: S.WAITING,
        sound: 'interrupt',
        ttlMs: ttlMs || 3000,
        phase: source,
        message: message || statusCopy('waiting', 7),
        detail: detail || 'DSH · 需要确认',
      }])
    }

    function fold(messages) {
      if (Array.isArray(messages) && messages.length > 0) {
        for (const message of messages) {
          if (!message || typeof message.kind !== 'string') continue
          if (message.kind === 'state' || message.kind === 'task') {
            const next = { ...base }
            if (message.state) next.state = message.state
            if (message.activity) next.activity = message.activity
            if (message.message) next.message = message.message
            if (message.detail) next.detail = message.detail
            if (message.project) next.project = message.project
            if (message.task !== undefined) next.task = message.task
            if (message.progress) next.progress = message.progress
            base = next
          } else if (message.kind === 'pulse') {
            if (message.sound === 'interrupt') {
              interruptCount += 1
              lastInterruptAt = Date.now()
              lastInterruptSource = message.phase || 'pulse'
            }
            const nextPulse = {
              seq: ++pulseSeq,
              state: message.state,
              message: message.message,
              detail: message.detail,
              sound: message.sound || null,
              dizzy: message.dizzy === true,
              until: Date.now() + (message.ttlMs || 2200),
            }
            // 竞态保护：带提示音的脉冲（目标完成/等待确认）未过期时，
            // 不被紧随其后的静音脉冲覆盖，保证提示音一定触发
            if (!(nextPulse.sound === null && pulse && pulse.sound
              && pulse.until > Date.now())) {
              pulse = nextPulse
            }
          }
        }
        rev += 1
      }
    }

    // ---------------- 事件监听（全局，观察所有顶层 Session） ----------------
    ctx.on('session/event', (session, event) => {
      try {
        fold(reducer.handle(session, event))
      } catch (error) {
        console.error('dsh-pet reduce failed:', error)
      }
    }, { global: true })

    ctx.on('session/disposed', (session) => {
      try {
        fold(reducer.disposeSession(session))
      } catch (error) {
        console.error('dsh-pet dispose failed:', error)
      }
    }, { global: true })

    // 权限申请（sandbox 升级、批准等）→ 响「确认」提示音（冗余通道，主通道为 approval/asked 会话事件）
    ctx.on('approval/request', (req, next) => {
      try {
        emitInterrupt('approval', statusCopy('waiting', 7), 'DSH · 需要权限确认', 3000)
      } catch (error) {
        console.error('dsh-pet approval pulse failed:', error)
      }
      return next()
    }, { global: true })

    // ---------------- HTTP：浏览器轮询宠物状态 ----------------
    // ---------------- 素材路由：/plugins/dsh-pet/assets/<file> ----------------
    const fsvc = ctx.get('fs')
    const webServer = ctx.get('webServer')
    if (!fsvc) console.error('dsh-pet: fs service unavailable')
    if (!webServer) console.error('dsh-pet: webServer service unavailable')

    function snapshotJson() {
      return {
        rev,
        base: {
          state: base.state,
          activity: base.activity || null,
          message: base.message,
          detail: base.detail,
          project: base.project || null,
          task: base.task || null,
          progress: base.progress || null,
        },
        pulse,
        // 诊断字段：确认音触发统计
        diag: {
          interruptCount,
          lastInterruptAt,
          lastInterruptSource,
          pulseSeq,
        },
      }
    }

    const byteCache = new Map()
    async function readFileBytes(absPath) {
      const cached = byteCache.get(absPath)
      if (cached !== undefined) return cached
      const target = await fsvc.resolve(absPath)
      const bytes = await fsvc.readBytes(target, undefined, MAX_BYTES)
      byteCache.set(absPath, bytes)
      return bytes
    }

    function sanitizeRel(prefix, pathname) {
      const suffix = pathname.slice(prefix.length)
      const parts = suffix.split('/').filter((part) => part && part !== '.' && part !== '..')
      const rel = parts.join('/')
      if (!rel || rel.length > 200) return undefined
      if (!/^[\w\-.\\/ ]+$/u.test(rel)) return undefined
      return rel
    }

    if (fsvc && webServer) {
      const mimeByExt = {
        '.png': 'image/png',
        '.mp3': 'audio/mpeg',
        '.json': 'application/json; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
      }

      // 状态接口：小部件每 700ms 轮询一次
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: ROUTE_PREFIX + '/state.json',
        handler: (req, res) => {
          const payload = JSON.stringify(snapshotJson())
          const length = new TextEncoder().encode(payload).length
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'content-length': length,
          })
          res.end(payload)
        },
      }, 'dsh-pet state route'))

      // 小部件脚本：随 index.html 注入，页面刷新后自动恢复桌宠
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: ROUTE_PREFIX + '/pet.js',
        handler: async (req, res) => {
          try {
            // 不缓存：小部件脚本可随时热更新，页面刷新即生效
            const target = await fsvc.resolve(WIDGET_PATH)
            const bytes = await fsvc.readBytes(target, undefined, MAX_BYTES)
            res.writeHead(200, {
              'content-type': 'text/javascript; charset=utf-8',
              'cache-control': 'no-store',
              'content-length': bytes.length,
            })
            res.end(bytes)
          } catch (error) {
            console.error('dsh-pet widget error:', error && error.message ? error.message : error)
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('widget unavailable')
          }
        },
      }, 'dsh-pet widget route'))

      // 注入：每次 index.html 渲染都带上小部件脚本
      ctx.effect(() => webServer.tapIndex((html) => {
        if (html.indexOf('/plugins/dsh-pet/pet.js') !== -1) return html
        const tag = '<script defer src="/plugins/dsh-pet/pet.js"></script>'
        if (html.indexOf('</head>') !== -1) return html.replace('</head>', tag + '</head>')
        return html + tag
      }))

      // 素材：PNG / MP3 原始字节
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX + '/assets',
        handler: async (req, res) => {
          try {
            const pathname = (req.url || '/').split('?')[0]
            const rel = sanitizeRel(ROUTE_PREFIX + '/assets', pathname)
            if (!rel) {
              res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
              res.end('not found')
              return
            }
            const bytes = await readFileBytes(ASSET_ROOT + '/' + rel)
            const dot = rel.lastIndexOf('.')
            const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : ''
            const mime = mimeByExt[ext] || 'application/octet-stream'
            res.writeHead(200, {
              'content-type': mime,
              'cache-control': 'public, max-age=3600',
              'content-length': bytes.length,
            })
            res.end(bytes)
          } catch (error) {
            console.error('dsh-pet asset error:', error && error.message ? error.message : error)
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('asset unavailable')
          }
        },
      }, 'dsh-pet assets route'))
    }
  },
}