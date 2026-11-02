/* ---------- controle ---------- */

function render(previousStep) {
  const step = state.step
  const trace = state.trace
  const lastEvent = step > 0 ? trace.events[step - 1] : null
  const focus = renderTree(step)

  elements.explainText.innerHTML = narrate(step)
  renderSummary(step)
  renderReturns(step)
  renderStack(focus, lastEvent)
  renderVars(focus, lastEvent, step)
  renderLog(previousStep, step)
  refreshTooltip()

  elements.slider.value = step
  elements.counter.textContent = `passo ${step} / ${trace.events.length}`
  vscode.postMessage({
    type: 'line',
    line: lastEvent && focus ? focus.line || state.data.fnLine : null,
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
  clearTimeout(state.timer)
  elements.play.textContent = '▶ Play'
}

function tick() {
  if (!state.playing) return
  if (state.step >= state.trace.events.length) {
    pause()
    return
  }
  goTo(state.step + 1, false)
  scheduleNext()
}

function scheduleNext() {
  clearTimeout(state.timer)
  const speed = Number(elements.speedSelect.value)
  state.timer = setTimeout(tick, DELAY_MS[elements.modeSelect.value] / speed)
}

function onTimingChange() {
  if (state.playing) scheduleNext()
}

function play() {
  if (state.step >= state.trace.events.length) goTo(0, false)
  state.playing = true
  elements.play.textContent = '⏸ Pausar'
  tick()
}

function togglePlay() {
  if (state.playing) pause()
  else play()
}

function selectRoot(index) {
  pause()
  const trace = buildTrace(state.roots[index])
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
  play()
}

function applyVisibility() {
  elements.explain.hidden = !elements.showExplain.checked
  elements.returns.hidden = !elements.showReturns.checked
  elements.sidebar.hidden = !elements.showSidebar.checked
}

function saveSettings() {
  vscode.postMessage({
    type: 'settings',
    settings: {
      mode: elements.modeSelect.value,
      speed: elements.speedSelect.value,
      showExplain: elements.showExplain.checked,
      showReturns: elements.showReturns.checked,
      showSidebar: elements.showSidebar.checked,
    },
  })
}

function applySettings(settings) {
  if (settings.mode) elements.modeSelect.value = settings.mode
  if (settings.speed) elements.speedSelect.value = settings.speed
  elements.showExplain.checked = Boolean(settings.showExplain)
  elements.showReturns.checked = Boolean(settings.showReturns)
  elements.showSidebar.checked = settings.showSidebar !== false
  applyVisibility()
}

applyVisibility()
for (const control of [
  elements.showExplain,
  elements.showReturns,
  elements.showSidebar,
  elements.modeSelect,
  elements.speedSelect,
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

elements.rootSelect.addEventListener('change', () => selectRoot(Number(elements.rootSelect.value)))
elements.slider.addEventListener('input', () => goTo(Number(elements.slider.value), true))
elements.play.addEventListener('click', togglePlay)
elements.modeSelect.addEventListener('change', onTimingChange)
elements.speedSelect.addEventListener('change', onTimingChange)
elements.first.addEventListener('click', () => goTo(0, true))
elements.prev.addEventListener('click', () => goTo(state.step - 1, true))
elements.next.addEventListener('click', () => goTo(state.step + 1, true))
elements.last.addEventListener('click', () => goTo(state.trace.events.length, true))
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
