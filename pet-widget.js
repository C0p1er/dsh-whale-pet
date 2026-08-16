// DSH 桌宠（大肥鱼）· 页面级小部件
// 由 Host 端通过 webServer.tapIndex 注入到 index.html，随页面常驻，
// 页面刷新后自动重新执行，因此桌宠不会因刷新而消失。
// 通过轮询 /plugins/dsh-pet/state.json 获取 Agent 状态；
// 素材（PNG/MP3）直接由 /plugins/dsh-pet/assets/ 路由提供。
// 设置存 localStorage（键 dsh-pet-settings），刷新后保留。
(function () {
  'use strict'

  if (window.__dshPetInstalled) return
  window.__dshPetInstalled = true

  var STATE_URL = '/plugins/dsh-pet/state.json'
  var ASSET_URL = '/plugins/dsh-pet/assets/'
  var SOUND_URL = ASSET_URL + 'finished.mp3'
  var INTERRUPT_URL = ASSET_URL + 'interrupt.mp3'
  var SETTINGS_KEY = 'dsh-pet-settings'

  var MANIFEST = {
    baseSize: 238,
    maxFrameWidth: 238,
    maxFrameHeight: 260,
    clips: {
      idle: { frames: ['idle_front/idle_front_238.png'], frameMs: 180, loop: true, motion: 'breathe' },
      blink: { frames: ['idle_blink/idle_blink_238_00.png', 'idle_blink/idle_blink_238_01.png', 'idle_blink/idle_blink_238_02.png', 'idle_blink/idle_blink_238_03.png', 'idle_blink/idle_blink_238_04.png'], frameMs: 100, loop: false },
      glance: { frames: ['idle_glance/idle_glance_238_00.png', 'idle_glance/idle_glance_238_01.png', 'idle_glance/idle_glance_238_02.png', 'idle_glance/idle_glance_238_03.png', 'idle_glance/idle_glance_238_04.png', 'idle_glance/idle_glance_238_05.png', 'idle_glance/idle_glance_238_06.png'], frameMs: 160, loop: false },
      thinking: { frames: ['idle_think/idle_think_238.png'], frameMs: 180, loop: true, motion: 'think' },
      working: { frames: ['sweep/sweep_238.png'], frameMs: 180, loop: true, motion: 'work' },
      working_search: { frames: ['walk_side/walk_side_238_00.png', 'walk_side/walk_side_238_01.png', 'walk_side/walk_side_238_02.png', 'walk_side/walk_side_238_03.png'], frameMs: 135, loop: true },
      working_command: { frames: ['walk_side_right/walk_side_right_238_00.png', 'walk_side_right/walk_side_right_238_01.png', 'walk_side_right/walk_side_right_238_02.png', 'walk_side_right/walk_side_right_238_03.png'], frameMs: 135, loop: true },
      waiting: { frames: ['talk/talk_238.png'], frameMs: 180, loop: true, motion: 'wait' },
      success: { frames: ['happy/happy_238.png'], frameMs: 180, loop: true, motion: 'bounce' },
      error: { frames: ['angry/angry_238.png'], frameMs: 180, loop: true, motion: 'shake' },
      error_dizzy: { frames: ['dizzy/dizzy_238.png'], frameMs: 180, loop: true, motion: 'dizzy' },
      dragging: { frames: ['dragging/dragging_238.png'], frameMs: 180, loop: true, motion: 'float' },
      head_pat: { frames: ['head_pat/head_pat_238_00.png', 'head_pat/head_pat_238_01.png', 'head_pat/head_pat_238_02.png', 'head_pat/head_pat_238_03.png', 'head_pat/head_pat_238_04.png', 'head_pat/head_pat_238_05.png'], frameMs: 180, loop: false },
      poke: { frames: ['poke_react/poke_react_238_00.png', 'poke_react/poke_react_238_01.png', 'poke_react/poke_react_238_02.png', 'poke_react/poke_react_238_03.png'], frameMs: 170, loop: false },
      tail: { frames: ['tail_react/tail_react_238_00.png', 'tail_react/tail_react_238_01.png', 'tail_react/tail_react_238_02.png', 'tail_react/tail_react_238_03.png'], frameMs: 220, loop: false }
    },
    stateMap: { IDLE: 'idle', THINKING: 'thinking', WORKING: 'working', WAITING: 'waiting', SUCCESS: 'success', ERROR: 'error', DISCONNECTED: 'idle' },
    workingActivityMap: { searching: 'working_search', commanding: 'working_command', editing: 'working', testing: 'working_command', 'using-tool': 'working' },
    idleMicroClips: ['blink', 'glance']
  }

  var ACTIVITY_CFG = {
    lively: { microDelay: [1200, 4200], bubbleDuration: 2600, bubbleCooldown: 6000 },
    normal: { microDelay: [2800, 8000], bubbleDuration: 3600, bubbleCooldown: 10000 },
    quiet: { microDelay: [9000, 17000], bubbleDuration: 5000, bubbleCooldown: 18000 }
  }
  var DEFAULT_SETTINGS = { scale: 1, opacity: 1, activityLevel: 'normal', soundEnabled: true, volume: 0.8 }

  // ---------------- 设置（localStorage 持久化） ----------------
  var settings = loadSettings()
  function loadSettings() {
    var base = {}
    for (var key in DEFAULT_SETTINGS) base[key] = DEFAULT_SETTINGS[key]
    try {
      var raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) {
        var saved = JSON.parse(raw)
        if (saved && typeof saved === 'object') {
          for (var k in saved) if (k in base) base[k] = saved[k]
        }
      }
    } catch (error) {}
    return base
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch (error) {}
  }

  // ---------------- 样式 ----------------
  var style = document.createElement('style')
  style.textContent = [
    '.dsh-pet-root{position:fixed;right:18px;bottom:14px;z-index:2147483647;pointer-events:auto;user-select:none;-webkit-user-select:none;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.4}',
    '.dsh-pet-stage{position:relative;cursor:grab;touch-action:none}',
    '.dsh-pet-dragging .dsh-pet-stage{cursor:grabbing}',
    '.dsh-pet-img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}',
    '.dsh-pet-fallback{font-size:46px;width:100%;height:100%;display:flex;align-items:center;justify-content:center}',
    '.dsh-pet-bubble{position:absolute;right:-4px;bottom:calc(100% + 10px);width:max-content;max-width:250px;background:var(--surface-color,#ffffff);color:var(--text-color,#1f2328);border:1px solid var(--border-color,#e2e2e2);border-radius:12px;padding:8px 12px;box-shadow:0 6px 20px rgba(0,0,0,.14);font-size:12.5px;text-align:left;pointer-events:none}',
    '.dsh-pet-bubble::after{content:"";position:absolute;right:22px;top:100%;border:6px solid transparent;border-top-color:var(--surface-color,#ffffff)}',
    '.dsh-pet-bubble-title{font-weight:600}',
    '.dsh-pet-st-success .dsh-pet-bubble-title{color:#1a7f37}',
    '.dsh-pet-st-error .dsh-pet-bubble-title{color:#cf222e}',
    '.dsh-pet-st-waiting .dsh-pet-bubble-title{color:#9a6700}',
    '.dsh-pet-st-working .dsh-pet-bubble-title{color:#0969da}',
    '.dsh-pet-st-thinking .dsh-pet-bubble-title{color:#57606a}',
    '.dsh-pet-st-idle .dsh-pet-bubble-title{color:var(--text-color,#1f2328)}',
    '.dsh-pet-backdrop{position:fixed;inset:0;z-index:1}',
    '.dsh-pet-menu{position:absolute;right:0;bottom:calc(100% + 46px);z-index:2;min-width:190px;background:var(--surface-color,#ffffff);color:var(--text-color,#1f2328);border:1px solid var(--border-color,#e2e2e2);border-radius:12px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:12.5px}',
    '.dsh-pet-menu-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 6px}',
    '.dsh-pet-menu-row span{flex:0 0 auto}',
    '.dsh-pet-menu-row input[type=range]{width:84px;margin:0}',
    '.dsh-pet-menu-row select{min-width:72px;padding:3px 6px;border-radius:8px;border:1px solid var(--border-color,#d8d8d8);background:var(--surface-color,#fff);color:inherit;font-size:12px}',
    '.dsh-pet-menu-row em{flex:0 0 34px;text-align:right;font-style:normal;opacity:.7}',
    '.dsh-pet-menu-item{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;border:0;background:transparent;color:inherit;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:12.5px;text-align:left}',
    '.dsh-pet-menu-item:hover{background:var(--hover-color,rgba(0,0,0,.07))}',
    '.dsh-pet-menu-sep{height:1px;background:var(--border-color,#e2e2e2);margin:5px 4px}',
    '.dsh-pet-restore{width:34px;height:34px;border-radius:50%;border:1px solid var(--border-color,#e2e2e2);background:var(--surface-color,#ffffff);box-shadow:0 4px 12px rgba(0,0,0,.16);cursor:pointer;font-size:17px;display:flex;align-items:center;justify-content:center}',
    '@keyframes dshPetBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.02) translateY(-2px)}}',
    '@keyframes dshPetThink{0%,100%{transform:rotate(0) translateY(0)}20%{transform:rotate(-4deg) translateY(-2px)}40%{transform:rotate(3deg) translateY(-1px)}60%{transform:rotate(-2deg) translateY(-3px)}80%{transform:rotate(2deg) translateY(-1px)}}',
    '@keyframes dshPetWork{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px) rotate(-1.5deg)}50%{transform:translateX(2px) rotate(1deg)}75%{transform:translateX(-2px) rotate(0)}}',
    '@keyframes dshPetWait{0%,100%{transform:rotate(0)}15%{transform:rotate(-5deg)}35%{transform:rotate(5deg)}55%{transform:rotate(-5deg)}75%{transform:rotate(5deg)}}',
    '@keyframes dshPetBounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-14px) scale(1.05)}60%{transform:translateY(0)}80%{transform:translateY(-6px)}}',
    '@keyframes dshPetShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}',
    '@keyframes dshPetDizzy{0%{transform:rotate(0)}25%{transform:rotate(8deg)}75%{transform:rotate(-8deg)}100%{transform:rotate(0)}}',
    '@keyframes dshPetFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}',
    '.dsh-pet-motion-breathe{animation:dshPetBreathe 2.6s ease-in-out infinite}',
    '.dsh-pet-motion-think{animation:dshPetThink 3.4s ease-in-out infinite}',
    '.dsh-pet-motion-work{animation:dshPetWork 1.8s ease-in-out infinite}',
    '.dsh-pet-motion-wait{animation:dshPetWait 3.6s ease-in-out infinite}',
    '.dsh-pet-motion-bounce{animation:dshPetBounce 1.1s ease-in-out infinite}',
    '.dsh-pet-motion-shake{animation:dshPetShake .7s ease-in-out infinite}',
    '.dsh-pet-motion-dizzy{animation:dshPetDizzy .9s ease-in-out infinite}',
    '.dsh-pet-motion-float{animation:dshPetFloat 2.4s ease-in-out infinite}',
    '@media (prefers-reduced-motion: reduce){.dsh-pet-root [class*="dsh-pet-motion-"]{animation:none}}'
  ].join('\n')
  document.head.appendChild(style)

  // ---------------- DOM ----------------
  var root = document.createElement('div')
  root.className = 'dsh-pet-root'
  var bubble = document.createElement('div')
  bubble.className = 'dsh-pet-bubble'
  bubble.style.display = 'none'
  var bubbleTitle = document.createElement('div')
  bubbleTitle.className = 'dsh-pet-bubble-title'
  bubble.appendChild(bubbleTitle)

  var stage = document.createElement('div')
  stage.className = 'dsh-pet-stage dsh-pet-motion-breathe'
  var petImg = document.createElement('img')
  petImg.className = 'dsh-pet-img'
  petImg.draggable = false
  petImg.alt = 'dsh-pet'
  var fallback = document.createElement('div')
  fallback.className = 'dsh-pet-fallback'
  fallback.textContent = '🐋'
  fallback.style.display = 'none'
  stage.appendChild(petImg)
  stage.appendChild(fallback)

  var backdrop = document.createElement('div')
  backdrop.className = 'dsh-pet-backdrop'
  backdrop.style.display = 'none'

  var menu = document.createElement('div')
  menu.className = 'dsh-pet-menu'
  menu.style.display = 'none'
  menu.innerHTML = [
    '<label class="dsh-pet-menu-row"><span>提示音</span><button class="dsh-pet-menu-item" data-act="sound" style="flex:0 0 auto;width:auto"></button></label>',
    '<label class="dsh-pet-menu-row"><span>提示音量</span><input type="range" data-act="volume" min="0" max="1" step="0.05"><em data-val="volume"></em></label>',
    '<label class="dsh-pet-menu-row"><span>透明度</span><input type="range" data-act="opacity" min="0.3" max="1" step="0.05"><em data-val="opacity"></em></label>',
    '<label class="dsh-pet-menu-row"><span>活跃程度</span><select data-act="activity"><option value="quiet">安静</option><option value="normal">标准</option><option value="lively">活泼</option></select></label>',
    '<label class="dsh-pet-menu-row"><span>角色大小</span><input type="range" data-act="scale" min="0.6" max="1.6" step="0.05"><em data-val="scale"></em></label>',
    '<div class="dsh-pet-menu-sep"></div>',
    '<button class="dsh-pet-menu-item" data-act="reset"><span>复位位置</span></button>',
    '<button class="dsh-pet-menu-item" data-act="hide"><span>隐藏宠物</span></button>'
  ].join('')

  var restoreBtn = document.createElement('button')
  restoreBtn.className = 'dsh-pet-restore'
  restoreBtn.title = '显示桌宠'
  restoreBtn.textContent = '🐟'
  restoreBtn.style.display = 'none'

  root.appendChild(backdrop)
  root.appendChild(menu)
  root.appendChild(bubble)
  root.appendChild(stage)
  root.appendChild(restoreBtn)
  document.body.appendChild(root)

  // ---------------- 状态 ----------------
  var state = null
  var lastRev = -1
  var frameIndex = 0
  var currentClipKey = 'idle'
  var interaction = null
  var dragging = false
  var hidden = false
  var pos = null
  var drag = null
  var audio = null
  var audioInterrupt = null
  var pendingSound = null // 'completion' | 'interrupt'
  var lastPulseSeq = 0
  var frameTimer = null
  var endTimer = null
  var microTimer = null
  var bubbleHideTimer = null
  var lastBubbleKey = ''
  var lastBubblePopAt = 0
  var fitScale = 1 // 窗口过小时的自适应缩放（叠加在角色大小之上）

  // 计算自适应缩放：保证宠物完整显示在视口内（宽 ≤ 35% 视口宽、高 ≤ 50% 视口高）
  function updateFit() {
    var baseW = MANIFEST.baseSize || 238
    var baseH = MANIFEST.maxFrameHeight || 260
    var scaledW = baseW * settings.scale
    var scaledH = baseH * settings.scale
    var fit = Math.min(1, (window.innerWidth * 0.35) / scaledW, (window.innerHeight * 0.5) / scaledH)
    fitScale = Math.max(0.2, fit)
  }

  function ensureAudio() {
    if (audio) return
    try {
      audio = new Audio(SOUND_URL)
      audio.preload = 'auto'
      audio.volume = settings.volume
      audioInterrupt = new Audio(INTERRUPT_URL)
      audioInterrupt.preload = 'auto'
      audioInterrupt.volume = settings.volume
    } catch (error) {}
  }

  function playSound(kind) {
    ensureAudio()
    var element = kind === 'interrupt' ? audioInterrupt : audio
    if (!element) { pendingSound = kind; return }
    try {
      element.currentTime = 0
      element.volume = settings.volume
      var play = element.play()
      if (play && typeof play.catch === 'function') {
        play.catch(function () { pendingSound = kind })
      }
    } catch (error) { pendingSound = kind }
  }

  function unlockAudio() {
    if (pendingSound) {
      var kind = pendingSound
      pendingSound = null
      playSound(kind)
    }
  }

  // ---------------- 动作解析 ----------------
  function resolveClip() {
    var now = Date.now()
    var pulseActive = state && state.pulse && now < state.pulse.until ? state.pulse : null
    var base = state ? state.base : null
    var baseState = base ? base.state : 'IDLE'
    var key
    if (dragging) key = 'dragging'
    else if (interaction) key = interaction.clip
    else if (pulseActive) {
      // 工具调用失败脉冲带 dizzy 标记 → 眩晕剪辑（更贴合情绪）；其余按状态映射
      key = pulseActive.dizzy ? 'error_dizzy' : (MANIFEST.stateMap[pulseActive.state] || 'idle')
    } else {
      key = MANIFEST.stateMap[baseState] || 'idle'
      if (baseState === 'WORKING' && base && base.activity && MANIFEST.workingActivityMap[base.activity]) {
        key = MANIFEST.workingActivityMap[base.activity]
      }
    }
    return { key: key, pulseActive: pulseActive, base: base, baseState: baseState }
  }

  // ---------------- 渲染 ----------------
  function render() {
    if (hidden) {
      root.className = 'dsh-pet-root'
      root.style.opacity = String(settings.opacity)
      bubble.style.display = 'none'
      stage.style.display = 'none'
      restoreBtn.style.display = 'flex'
      menu.style.display = 'none'
      backdrop.style.display = 'none'
      return
    }
    restoreBtn.style.display = 'none'
    stage.style.display = 'block'

    var resolved = resolveClip()
    var clip = MANIFEST.clips[resolved.key] || MANIFEST.clips.idle
    var shownState = resolved.pulseActive ? resolved.pulseActive.state : resolved.baseState
    var bubbleData = resolved.pulseActive || resolved.base

    // 自适应缩放（窗口变小 → 宠物自动缩小以完整显示）
    updateFit()

    // 位置与透明度：绑定窗口右/下边缘（拖动后也保持边缘距离，窗口缩放时自动跟随）
    var styleObj = ''
    if (pos) styleObj = 'right:' + pos.right + 'px;bottom:' + pos.bottom + 'px;'
    root.setAttribute('style', styleObj + 'opacity:' + settings.opacity)
    root.classList.toggle('dsh-pet-dragging', dragging)

    // 气泡：仅在执行任务（非 IDLE 或脉冲）时弹出；空闲时完全不弹窗；
    // 弹窗频率按活跃程度限制：冷却期内状态变化只原位更新内容，不重新弹出
    var isPulse = !!resolved.pulseActive
    var isExecuting = !!(resolved.pulseActive || (resolved.baseState !== 'IDLE'))
    var bubbleKey = isExecuting
      ? String(shownState || 'idle') + '|' + (bubbleData ? bubbleData.message : '') + '|' + (bubbleData ? bubbleData.detail : '')
      : ''
    if (bubbleKey !== lastBubbleKey) {
      lastBubbleKey = bubbleKey
      if (isExecuting) {
        var cfg = ACTIVITY_CFG[settings.activityLevel] || ACTIVITY_CFG.normal
        if (isPulse || bubble.style.display === 'block' || Date.now() - lastBubblePopAt >= cfg.bubbleCooldown) {
          showBubble()
        }
      } else {
        bubble.style.display = 'none'
      }
    }

    // 帧图
    var newKey = resolved.key
    if (newKey !== currentClipKey) {
      currentClipKey = newKey
      frameIndex = 0
      if (frameTimer) { clearInterval(frameTimer); frameTimer = null }
      if (endTimer) { clearTimeout(endTimer); endTimer = null }
      if (clip.frames.length > 1) {
        frameTimer = setInterval(function () {
          frameIndex += 1
          if (frameIndex >= clip.frames.length) {
            if (clip.loop) frameIndex = 0
            else frameIndex = clip.frames.length - 1
          }
          petImg.src = ASSET_URL + 'pet/' + clip.frames[frameIndex]
          if (!clip.loop && frameIndex >= clip.frames.length - 1) {
            if (endTimer) clearTimeout(endTimer)
            endTimer = setTimeout(function () { interaction = null; render() }, 400)
          }
        }, clip.frameMs || 160)
      }
    }
    petImg.src = ASSET_URL + 'pet/' + clip.frames[Math.min(frameIndex, clip.frames.length - 1)]
    // 固定画布尺寸：无论哪个动作/帧，宠物大小都不变（object-fit: contain 等比例容纳）；
    // 叠加自适应缩放，窗口缩小时宠物自动缩小并始终完整可见
    stage.className = 'dsh-pet-stage dsh-pet-motion-' + (clip.motion || 'breathe')
    stage.style.width = (MANIFEST.baseSize || 238) * settings.scale * fitScale + 'px'
    stage.style.height = (MANIFEST.maxFrameHeight || 260) * settings.scale * fitScale + 'px'

    // 菜单当前值
    syncMenu()
    scheduleMicro()
  }

  function syncMenu() {
    var soundBtn = menu.querySelector('[data-act="sound"]')
    if (soundBtn) soundBtn.textContent = settings.soundEnabled ? '开' : '关'
    var pairs = { volume: 'volume', opacity: 'opacity', scale: 'scale' }
    for (var key in pairs) {
      var input = menu.querySelector('[data-act="' + pairs[key] + '"]')
      if (input && String(input.value) !== String(settings[pairs[key]])) input.value = String(settings[pairs[key]])
      var val = menu.querySelector('[data-val="' + pairs[key] + '"]')
      if (val) val.textContent = Math.round(settings[pairs[key]] * 100) + '%'
    }
    var activity = menu.querySelector('[data-act="activity"]')
    if (activity && activity.value !== settings.activityLevel) activity.value = settings.activityLevel
  }

  // ---------------- 气泡弹出（仅执行任务时显示；频率由活跃程度的冷却期控制） ----------------
  function updateBubbleContent() {
    var resolved = resolveClip()
    var bubbleData = resolved.pulseActive || resolved.base
    if (!bubbleData) return
    var stateName = String(resolved.pulseActive ? resolved.pulseActive.state : (resolved.baseState || 'IDLE')).toLowerCase()
    bubble.className = 'dsh-pet-bubble dsh-pet-st-' + stateName
    bubbleTitle.textContent = bubbleData.message || ''
  }

  function showBubble() {
    if (hidden || dragging) return
    var wasHidden = bubble.style.display !== 'block'
    updateBubbleContent()
    if (wasHidden) {
      bubble.style.display = 'block'
      lastBubblePopAt = Date.now()
    }
    if (bubbleHideTimer) clearTimeout(bubbleHideTimer)
    var cfg = ACTIVITY_CFG[settings.activityLevel] || ACTIVITY_CFG.normal
    bubbleHideTimer = setTimeout(function () {
      bubbleHideTimer = null
      bubble.style.display = 'none'
    }, cfg.bubbleDuration)
  }

  function showBubbleText(title) {
    if (hidden) return
    bubble.className = 'dsh-pet-bubble dsh-pet-st-idle'
    bubbleTitle.textContent = title || ''
    bubble.style.display = 'block'
    if (bubbleHideTimer) clearTimeout(bubbleHideTimer)
    var cfg = ACTIVITY_CFG[settings.activityLevel] || ACTIVITY_CFG.normal
    bubbleHideTimer = setTimeout(function () {
      bubbleHideTimer = null
      bubble.style.display = 'none'
    }, cfg.bubbleDuration)
    lastBubbleKey = 'feedback|' + (title || '')
  }

  // ---------------- 微动作（眨眼 / 环顾）：所有状态下都会出现，频率由活跃程度决定 ----------------
  function scheduleMicro() {
    if (microTimer) { clearTimeout(microTimer); microTimer = null }
    if (!state || interaction || dragging || hidden) return
    var resolved = resolveClip()
    if (resolved.pulseActive) return
    var cfg = ACTIVITY_CFG[settings.activityLevel] || ACTIVITY_CFG.normal
    var delay = cfg.microDelay[0] + Math.random() * (cfg.microDelay[1] - cfg.microDelay[0])
    microTimer = setTimeout(function () {
      microTimer = null
      // 微动作按状态贴合情绪：思考时眨眼（若有所思），工作时环顾（专注间隙张望），空闲两者皆可
      var micros
      if (resolved.baseState === 'THINKING') micros = ['blink']
      else if (resolved.baseState === 'WORKING') micros = ['glance']
      else micros = MANIFEST.idleMicroClips || ['blink', 'glance']
      interaction = { clip: micros[Math.floor(Math.random() * micros.length)] }
      render()
    }, delay)
  }

  // ---------------- 轮询 ----------------
  function poll() {
    fetch(STATE_URL, { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null })
      .then(function (snap) {
        if (!snap || typeof snap !== 'object') return
        if (snap.rev !== lastRev) {
          lastRev = snap.rev
          state = snap
          // 提示音：仅当【新脉冲】（seq 变化）到达且未过期时播放一次，
          // 避免回合结束后残留脉冲随每个事件反复重播
          if (state && state.pulse && state.pulse.sound && settings.soundEnabled) {
            var pulse = state.pulse
            if (pulse.seq !== lastPulseSeq && Date.now() < pulse.until) {
              lastPulseSeq = pulse.seq
              playSound(pulse.sound === 'interrupt' ? 'interrupt' : 'completion')
            }
          }
          render()
        }
      })
      .catch(function () {})
  }
  setInterval(poll, 700)
  poll()

  // ---------------- 互动 ----------------
  stage.addEventListener('pointerdown', function (event) {
    unlockAudio()
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.preventDefault()
    var rect = stage.getBoundingClientRect()
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRight: pos ? pos.right : Math.max(0, window.innerWidth - rect.right),
      startBottom: pos ? pos.bottom : Math.max(0, window.innerHeight - rect.bottom),
      moved: false
    }
    try { stage.setPointerCapture(event.pointerId) } catch (error) {}
    closeMenu()
  })
  stage.addEventListener('pointermove', function (event) {
    if (!drag) return
    var dx = event.clientX - drag.startX
    var dy = event.clientY - drag.startY
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true
      dragging = true
    }
    if (!drag.moved) return
    var petW = (MANIFEST.baseSize || 238) * settings.scale * fitScale
    var petH = (MANIFEST.maxFrameHeight || 260) * settings.scale * fitScale
    var maxRight = Math.max(0, window.innerWidth - petW)
    var maxBottom = Math.max(0, window.innerHeight - petH)
    pos = {
      right: Math.min(maxRight, Math.max(0, drag.startRight - dx)),
      bottom: Math.min(maxBottom, Math.max(0, drag.startBottom - dy)),
    }
    root.setAttribute('style', 'right:' + pos.right + 'px;bottom:' + pos.bottom + 'px;opacity:' + settings.opacity)
  })
  function endDrag() {
    if (drag) drag = null
    if (dragging) {
      dragging = false
      render()
    }
  }
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)

  // 图片加载失败时回退显示 🐋
  petImg.addEventListener('error', function () {
    petImg.style.display = 'none'
    fallback.style.display = 'flex'
  })
  petImg.addEventListener('load', function () {
    petImg.style.display = 'block'
    fallback.style.display = 'none'
  })

  // ---------------- 菜单 ----------------
  function positionMenu() {
    var GAP = 8
    var menuW = menu.offsetWidth
    var menuH = menu.offsetHeight
    var rect = root.getBoundingClientRect()
    var vw = window.innerWidth
    var vh = window.innerHeight

    // 水平：优先与宠物右缘对齐（向左展开）；左缘放不下则与宠物左缘对齐；再放不下则贴边
    if (rect.right - menuW >= GAP) {
      menu.style.right = '0px'
      menu.style.left = 'auto'
    } else if (rect.left + menuW <= vw - GAP) {
      menu.style.right = 'auto'
      menu.style.left = '0px'
    } else {
      menu.style.right = 'auto'
      menu.style.left = Math.max(GAP, Math.min(rect.left, vw - menuW - GAP)) + 'px'
    }
    // 垂直：优先宠物上方（留出气泡空间）；顶部放不下则放宠物下方；再放不下则贴顶
    if (rect.top - menuH >= GAP + 46) {
      menu.style.bottom = (rect.height + 46) + 'px'
      menu.style.top = 'auto'
    } else if (rect.bottom + menuH <= vh - GAP) {
      menu.style.bottom = 'auto'
      menu.style.top = (rect.height + GAP) + 'px'
    } else {
      menu.style.bottom = 'auto'
      menu.style.top = GAP + 'px'
    }
  }

  function openMenu(event) {
    event.preventDefault()
    menu.style.display = 'block'
    backdrop.style.display = 'block'
    syncMenu()
    positionMenu()
  }
  function closeMenu() {
    menu.style.display = 'none'
    backdrop.style.display = 'none'
  }
  root.addEventListener('contextmenu', openMenu)
  backdrop.addEventListener('click', closeMenu)

  menu.addEventListener('click', function (event) {
    var target = event.target
    while (target && target !== menu && !target.getAttribute) target = target.parentNode
    var act = target && target.getAttribute ? target.getAttribute('data-act') : null
    if (!act) return
    if (act === 'sound') {
      settings.soundEnabled = !settings.soundEnabled
      saveSettings()
      syncMenu()
    } else if (act === 'reset') {
      pos = null
      render()
    } else if (act === 'hide') {
      hidden = true
      closeMenu()
      render()
    }
  })
  menu.addEventListener('input', function (event) {
    var act = event.target && event.target.getAttribute ? event.target.getAttribute('data-act') : null
    if (!act || act === 'activity') return
    var value = Number(event.target.value)
    if (!Number.isFinite(value)) return
    if (act === 'volume') settings.volume = value
    else if (act === 'opacity') settings.opacity = value
    else if (act === 'scale') settings.scale = value
    saveSettings()
    syncMenu()
    render()
  })
  menu.addEventListener('change', function (event) {
    var act = event.target && event.target.getAttribute ? event.target.getAttribute('data-act') : null
    if (act === 'activity') {
      settings.activityLevel = event.target.value
      saveSettings()
      var labels = { quiet: '安静', normal: '标准', lively: '活泼' }
      showBubbleText('已切换为「' + (labels[settings.activityLevel] || settings.activityLevel) + '」模式')
      render()
    }
  })

  restoreBtn.addEventListener('click', function () {
    hidden = false
    render()
  })

  // 窗口尺寸变化（如从最大化还原为窗口化）：位置按右/下边缘距离自动跟随窗口，
  // 只需防止宠物被挤到视口外（窗口过小时复位默认边缘位置）
  window.addEventListener('resize', function () {
    updateFit()
    if (pos) {
      var petW = (MANIFEST.baseSize || 238) * settings.scale * fitScale
      var petH = (MANIFEST.maxFrameHeight || 260) * settings.scale * fitScale
      var vw = window.innerWidth
      var vh = window.innerHeight
      if (petW >= vw || petH >= vh) {
        pos = null
      } else {
        pos = {
          right: Math.min(Math.max(0, pos.right), Math.max(0, vw - petW)),
          bottom: Math.min(Math.max(0, pos.bottom), Math.max(0, vh - petH)),
        }
      }
    }
    render()
  })

  // 初始渲染
  render()
})()