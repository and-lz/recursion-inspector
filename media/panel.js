/* ---------- controle ---------- */

function render(previousStep) {
  const step = state.step
  const trace = state.trace
  const lastEvent = step > 0 ? trace.events[step - 1] : null
  const focus = renderTree(step, previousStep)
  if (step === trace.events.length && step !== previousStep) showTreeTop()

  elements.explainText.innerHTML = narrate(step)
  renderSummary(step)
  renderReturns(step)
  renderStack(focus, lastEvent)
  renderVars(focus, lastEvent, step)
  renderLog(previousStep, step)
  if (state.inspected && focus && step !== previousStep) openInspector(focus)
  renderInspector()
  refreshTooltip()

  elements.slider.value = step
  elements.counter.textContent = `passo ${step} / ${trace.events.length}`
  vscode.postMessage({
    type: 'line',
    line: lastEvent && focus ? focus.line || state.data.fnLine : null,
  })
}

// Ao acabar, o foco vai para o primeiro nó (a raiz): topo e centro da árvore.
function showTreeTop() {
  state.trace.rootNode.element.scrollIntoView({
    block: 'start',
    inline: state.trace.outline ? 'start' : 'center',
  })
}

function goTo(step, userAction) {
  if (userAction) pause()
  const clamped = Math.max(0, Math.min(step, state.trace.events.length))
  const previous = state.step
  state.step = clamped
  render(previous)
}

function pause() {
  state.playing = false
  cancelAnimationFrame(state.timer)
  elements.play.textContent = '▶ Play'
}

// Explicado: um passo por vez, sem pressa. Compacto: a animação inteira cabe em COMPACT_TOTAL_MS.
function stepDelay() {
  if (elements.modeSelect.value === 'explained') return EXPLAINED_DELAY_MS
  return Math.min(COMPACT_MAX_DELAY_MS, COMPACT_TOTAL_MS / state.trace.events.length)
}

// O passo vem do relógio, não de um timer por passo: se renderizar demora mais que o intervalo,
// pula passos em vez de atrasar a animação.
function frame(now) {
  if (!state.playing) return
  const total = state.trace.events.length
  const target = state.playFrom.step + Math.floor((now - state.playFrom.time) / stepDelay())
  if (target > state.step) goTo(Math.min(target, total), false)
  if (state.step >= total) {
    pause()
    return
  }
  state.timer = requestAnimationFrame(frame)
}

function restartClock() {
  state.playFrom = { time: performance.now(), step: state.step }
}

function onTimingChange() {
  if (state.playing) restartClock()
}

function play() {
  if (state.step >= state.trace.events.length) goTo(0, false)
  state.playing = true
  elements.play.textContent = '⏸ Pausar'
  restartClock()
  state.timer = requestAnimationFrame(frame)
}

function togglePlay() {
  if (state.playing) pause()
  else play()
}

function selectRoot(index) {
  pause()
  closeInspector()
  const fullTrace = buildTrace(state.roots[index])
  const summarizable = fullTrace.events.length >= MAX_ANIMATED_STEPS
  elements.viewMode.hidden = !summarizable
  const trace = summarizable && state.summarized ? summarizeTrace(fullTrace) : fullTrace
  state.trace = trace
  state.step = 0
  buildTree(trace)
  renderFunctionLegend(trace)
  buildLog(trace)
  elements.slider.max = trace.events.length
  render(0)
}

function rootResultText(lastEvent) {
  if (lastEvent.t === 'r') return lastEvent.v.s
  if (lastEvent.t === 't') return 'erro'
  return '…'
}

function load(data) {
  pause()
  state.data = data
  applySettings(data.settings || {})
  state.roots = findRoots(data.events)
  elements.empty.hidden = true
  elements.app.hidden = false
  elements.title.textContent = `${data.fnName}(${data.params.join(', ')}) · ${data.fileName}:${data.fnLine}`

  if (!state.roots.length) {
    elements.app.hidden = true
    elements.empty.hidden = false
    elements.empty.textContent = data.error
      ? `A função não foi chamada antes do erro: ${data.error}`
      : 'A função não foi chamada durante a execução do arquivo. Chame-a no arquivo (ex.: com um exemplo) e inspecione de novo.'
    return
  }

  elements.rootSelect.replaceChildren()
  state.roots.forEach((root, index) => {
    const first = data.events[root.startIndex]
    const last = data.events[root.endIndex]
    const result = rootResultText(last)
    const option = document.createElement('option')
    option.value = index
    option.textContent = shorten(
      `#${index + 1}: ${first.fn}(${first.args.map((arg) => arg.s).join(', ')}) → ${result}`,
      60,
    )
    elements.rootSelect.append(option)
  })
  selectRoot(0)
  // Trace grande: animar não ajuda; vai direto ao resultado final.
  if (state.trace.events.length >= MAX_ANIMATED_STEPS || !elements.viewMode.hidden)
    goTo(state.trace.events.length, false)
  else play()
}

function applyVisibility() {
  elements.explain.hidden = !elements.showExplain.checked
  elements.returns.hidden = !elements.showReturns.checked
  elements.sidebar.hidden = !elements.showSidebar.checked
  if (elements.sidebar.hidden) {
    elements.sidebar.style.width = ''
    elements.sidebar.style.maxWidth = ''
  }
}

function saveSettings() {
  vscode.postMessage({
    type: 'settings',
    settings: {
      mode: elements.modeSelect.value,
      showExplain: elements.showExplain.checked,
      showReturns: elements.showReturns.checked,
      showSidebar: elements.showSidebar.checked,
      summarized: elements.viewMode.value === 'summary',
    },
  })
}

function applySettings(settings) {
  if (settings.mode) elements.modeSelect.value = settings.mode
  elements.showExplain.checked = Boolean(settings.showExplain)
  elements.showReturns.checked = Boolean(settings.showReturns)
  elements.showSidebar.checked = settings.showSidebar !== false
  state.summarized = settings.summarized !== false
  elements.viewMode.value = state.summarized ? 'summary' : 'full'
  applyVisibility()
}

applyVisibility()
for (const control of [
  elements.showExplain,
  elements.showReturns,
  elements.showSidebar,
  elements.modeSelect,
  elements.viewMode,
]) {
  control.addEventListener('change', saveSettings)
}
elements.showExplain.addEventListener('change', applyVisibility)
elements.showReturns.addEventListener('change', applyVisibility)
elements.showSidebar.addEventListener('change', applyVisibility)

elements.menuButton.addEventListener('click', (event) => {
  event.stopPropagation()
  elements.menu.hidden = !elements.menu.hidden
})
document.addEventListener('click', (event) => {
  if (!elements.menu.contains(event.target)) elements.menu.hidden = true
})

elements.viewMode.addEventListener('change', () => {
  state.summarized = elements.viewMode.value === 'summary'
  selectRoot(Number(elements.rootSelect.value))
  goTo(state.trace.events.length, false)
})
elements.rootSelect.addEventListener('change', () => selectRoot(Number(elements.rootSelect.value)))
elements.log.addEventListener('click', (event) => {
  const row = event.target.closest('.row')
  if (row) goTo(row.step, true)
})
elements.slider.addEventListener('input', () => goTo(Number(elements.slider.value), true))

const MIN_PANE_WIDTH = 200
const MIN_TREE_WIDTH = 200

// Arrastar a borda esquerda do painel muda a largura dele.
function makeResizable(handle, pane) {
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = pane.offsetWidth
    const maxWidth = () => window.innerWidth - MIN_TREE_WIDTH
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('dragging')
    const move = (moveEvent) => {
      const width = startWidth + startX - moveEvent.clientX
      pane.style.maxWidth = 'none'
      pane.style.width = `${Math.max(MIN_PANE_WIDTH, Math.min(width, maxWidth()))}px`
    }
    const stop = () => {
      handle.classList.remove('dragging')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  })
}
makeResizable(elements.sidebarResizer, elements.sidebar)
makeResizable(elements.inspectorResizer, elements.inspectorBox)

elements.inspectorClose.addEventListener('click', closeInspector)
elements.play.addEventListener('click', togglePlay)
elements.modeSelect.addEventListener('change', onTimingChange)
elements.first.addEventListener('click', () => goTo(0, true))
elements.prev.addEventListener('click', () => goTo(state.step - 1, true))
elements.next.addEventListener('click', () => goTo(state.step + 1, true))
elements.last.addEventListener('click', () => goTo(state.trace.events.length, true))
elements.treeWrap.addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey) zoomAt(event)
  },
  { passive: false },
)
elements.zoomReset.addEventListener('click', resetZoom)
// A orientação e a escala dependem da largura disponível.
window.addEventListener('resize', () => {
  if (state.viewport) relayoutTree()
})
document.addEventListener('keydown', (event) => {
  if (!state.trace || event.target.tagName === 'SELECT') return
  if (event.key === 'Escape') elements.menu.hidden = true
  if (event.key === ' ') {
    event.preventDefault()
    togglePlay()
  }
  if (event.key === 'ArrowRight') goTo(state.step + 1, true)
  if (event.key === 'ArrowLeft') goTo(state.step - 1, true)
})
window.addEventListener('message', (event) => {
  if (event.data.type === 'data') load(event.data.payload)
})
vscode.postMessage({ type: 'ready' })
