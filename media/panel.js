const vscode = acquireVsCodeApi()

const NODE_WIDTH_CHAR = 6.8
const NODE_HEIGHT = 40
const LEVEL_GAP = 40
const SLOT_GAP = 14
const MARGIN = 20
const MAX_LABEL = 30
const SVG_NS = 'http://www.w3.org/2000/svg'
const FN_COLORS = ['#3b82f6', '#c084fc', '#f97316', '#14b8a6', '#ec4899', '#a3a3a3']
const DELAY_MS = { explained: 1400, compact: 250 }

const elements = {}
for (const id of [
  'empty', 'app', 'fnLegend', 'menu', 'menuButton', 'showExplain', 'showReturns', 'showSidebar', 'sidebar', 'explain', 'returns', 'title', 'rootSelect', 'modeSelect', 'speedSelect', 'explainText', 'summary', 'tree', 'treeWrap',
  'returnChips', 'stack', 'vars', 'log', 'first', 'prev', 'play', 'next', 'last', 'slider', 'counter',
]) {
  elements[id] = document.getElementById(id)
}

const state = {
  data: null,
  roots: [],
  trace: null,
  step: 0,
  playing: false,
  timer: null,
  view: null,
}

function ordinal(index) {
  return `${index + 1}ª`
}

function escapeHtml(text) {
  return String(text).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char])
}

function code(text) {
  return `<code>${escapeHtml(text)}</code>`
}

function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function callText(node, field) {
  return `${node.fn}(${node.args.map((arg) => arg[field]).join(', ')})`
}

/* ---------- dados ---------- */

// Raiz = chamada da função clicada que não está dentro de outra chamada dela mesma.
// Chamadas de outras funções recursivas feitas lá dentro entram na mesma árvore.
function findRoots(events) {
  const roots = []
  const functionOf = new Map()
  let openTargets = 0
  let current = null

  events.forEach((event, index) => {
    if (event.t === 'c') {
      functionOf.set(event.id, event.fn)
      if (event.fn !== state.data.fnName) return
      if (openTargets === 0) {
        current = { startIndex: index, endIndex: events.length - 1, id: event.id }
        roots.push(current)
      }
      openTargets++
      return
    }
    if (functionOf.get(event.id) !== state.data.fnName) return
    openTargets--
    if (openTargets === 0) current.endIndex = index
  })
  return roots
}

function buildTrace(root) {
  const events = state.data.events.slice(root.startIndex, root.endIndex + 1)
  const nodes = new Map()
  let maxDepth = 0

  events.forEach((event, index) => {
    if (event.t === 'c') {
      const node = {
        id: event.id, fn: event.fn, parent: nodes.get(event.parent) || null, children: [], depth: event.depth - events[0].depth,
        args: event.args, line: event.line, callIndex: index, endIndex: Infinity, kind: null, value: null, message: null,
      }
      if (node.parent) node.parent.children.push(node)
      nodes.set(event.id, node)
      maxDepth = Math.max(maxDepth, node.depth)
      return
    }
    const node = nodes.get(event.id)
    node.endIndex = index
    node.kind = event.t === 'r' ? 'return' : 'throw'
    node.value = event.v || null
    node.message = event.msg || null
  })

  return { events, nodes, rootNode: nodes.get(root.id), maxDepth, total: nodes.size }
}

/* ---------- layout e DOM da árvore ---------- */

function svg(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes || {})) element.setAttribute(name, value)
  return element
}

function functionColor(name) {
  const names = Object.keys(state.data.functionParams)
  return FN_COLORS[names.indexOf(name) % FN_COLORS.length]
}

function renderFunctionLegend(trace) {
  const used = [...new Set([...trace.nodes.values()].map((node) => node.fn))]
  elements.fnLegend.replaceChildren()
  if (used.length < 2) return
  for (const name of used) {
    const chip = document.createElement('span')
    chip.className = 'fnChip'
    chip.style.background = functionColor(name)
    chip.textContent = name
    elements.fnLegend.append(chip)
  }
}

function layout(trace) {
  const order = []
  const pending = [trace.rootNode]
  while (pending.length) {
    const node = pending.pop()
    order.push(node)
    for (const child of node.children) pending.push(child)
  }

  let leaves = 0
  for (let index = order.length - 1; index >= 0; index--) {
    const node = order[index]
    if (node.children.length === 0) node.slot = leaves++
    else node.slot = (node.children[0].slot + node.children[node.children.length - 1].slot) / 2
  }

  const longest = order.reduce((max, node) => Math.max(max, callText(node, 's').length), 10)
  const nodeWidth = Math.min(longest, MAX_LABEL) * NODE_WIDTH_CHAR + 32
  const slotWidth = nodeWidth + SLOT_GAP
  for (const node of order) {
    node.x = MARGIN + node.slot * slotWidth
    node.y = MARGIN + node.depth * (NODE_HEIGHT + LEVEL_GAP)
  }
  return { nodeWidth, width: MARGIN * 2 + leaves * slotWidth, height: MARGIN * 2 + (trace.maxDepth + 1) * (NODE_HEIGHT + LEVEL_GAP), order }
}

function buildTree(trace) {
  const tree = elements.tree
  tree.replaceChildren()
  const { nodeWidth, width, height, order } = layout(trace)
  tree.setAttribute('width', width)
  tree.setAttribute('height', height)

  const edgeLayer = svg('g')
  const nodeLayer = svg('g')
  const valueLayer = svg('g')
  tree.append(edgeLayer, nodeLayer, valueLayer)

  for (const node of order) {
    node.element = svg('g', { class: 'node hidden', transform: `translate(${node.x},${node.y})` })
    node.element.append(svg('rect', { width: nodeWidth, height: NODE_HEIGHT }))
    const tag = svg('rect', { class: 'tag', width: 8, height: NODE_HEIGHT - 12, x: 6, y: 6 })
    tag.style.fill = functionColor(node.fn)
    node.element.append(tag)
    const label = svg('text', { x: 20, y: 16 })
    label.textContent = shorten(callText(node, 's'), MAX_LABEL)
    node.retText = svg('text', { x: 20, y: 31, class: 'ret' })
    const title = svg('title')
    title.textContent = callText(node, 'f')
    node.element.append(label, node.retText, title)
    node.element.addEventListener('click', () => goTo(node.callIndex + 1, true))
    nodeLayer.append(node.element)
    node.className = 'node hidden'
    node.isBase = node.children.length === 0

    if (!node.parent) {
      node.edgeValue = svg('text', {
        class: 'edgeValue hidden',
        'text-anchor': 'middle',
        x: node.x + nodeWidth / 2,
        y: node.y - 6,
      })
      node.edgeValueClass = 'edgeValue hidden'
      valueLayer.append(node.edgeValue)
      continue
    }
    const startX = node.parent.x + nodeWidth / 2
    const startY = node.parent.y + NODE_HEIGHT
    const endX = node.x + nodeWidth / 2
    const middleY = (startY + node.y) / 2
    node.edge = svg('path', { class: 'edge hidden', d: `M${startX},${startY} C${startX},${middleY} ${endX},${middleY} ${endX},${node.y}` })
    node.edgeClass = 'edge hidden'
    edgeLayer.append(node.edge)

    node.edgeValue = svg('text', {
      class: 'edgeValue hidden',
      'text-anchor': 'middle',
      x: (startX + endX) / 2,
      y: middleY + 4,
    })
    node.edgeValueClass = 'edgeValue hidden'
    valueLayer.append(node.edgeValue)
  }

  trace.nodeWidth = nodeWidth
}

function nodeState(node, step, lastEvent) {
  if (node.callIndex >= step) return 'hidden'
  if (lastEvent && lastEvent.id === node.id) {
    if (lastEvent.t === 'c') return 'active'
    return lastEvent.t === 'r' ? 'returning' : 'error'
  }
  if (node.endIndex < step) return node.kind === 'throw' ? 'error' : 'done'
  return 'waiting'
}

function returnText(node, stateName) {
  if (stateName === 'hidden' || stateName === 'active' || stateName === 'waiting') return ''
  const prefix = node.isBase ? '🛑 ' : ''
  if (node.kind === 'throw') return `${prefix}✖ ${shorten(node.message, 22)}`
  return `${prefix}↩ ${shorten(node.value.s, 24)}`
}

function updateEdgeValue(node, stateName) {
  const returned = stateName === 'done' || stateName === 'returning' || stateName === 'error'
  const className = `edgeValue${returned ? '' : ' hidden'}${stateName === 'returning' ? ' latest' : ''}${stateName === 'error' ? ' failed' : ''}`
  if (className === node.edgeValueClass) return
  node.edgeValueClass = className
  node.edgeValue.setAttribute('class', className)
  node.edgeValue.textContent = !returned ? '' : node.kind === 'throw' ? '✖' : shorten(node.value.s, 14)
}

function renderTree(step) {
  const trace = state.trace
  const lastEvent = step > 0 ? trace.events[step - 1] : null
  let focus = null

  for (const node of trace.nodes.values()) {
    const stateName = nodeState(node, step, lastEvent)
    const className = `node ${stateName}${node.isBase ? ' base' : ''}`
    if (className !== node.className) {
      node.className = className
      node.element.setAttribute('class', className)
      node.retText.textContent = returnText(node, stateName)
    }
    if (stateName === 'active' || stateName === 'returning' || stateName === 'error') focus = node

    updateEdgeValue(node, stateName)
    if (!node.edge) continue
    const edgeClass = `edge${stateName === 'hidden' ? ' hidden' : ''}${
      lastEvent && lastEvent.id === node.id ? (lastEvent.t === 'c' ? ' descending' : ' ascending') : ''
    }`
    if (edgeClass === node.edgeClass) continue
    node.edgeClass = edgeClass
    node.edge.setAttribute('class', edgeClass)
  }

  if (focus) focus.element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return focus
}

/* ---------- narração didática ---------- */

function narrate(step) {
  const trace = state.trace
    if (step === 0) {
    return `Aperte <b>▶ Play</b> ou arraste o slider. A primeira chamada é ${code(callText(trace.rootNode, 'f'))}: ninguém a chamou, é o ponto de partida.`
  }

  const event = trace.events[step - 1]
  const node = trace.nodes.get(event.id)
  const parentCall = node.parent ? code(callText(node.parent, 's')) : null
  const call = code(callText(node, 'f'))

  if (event.t === 'c') {
    if (!node.parent) return `<b>Início.</b> ${call} é a chamada inicial (profundidade 0). Ela vai ficar <i>esperando</i> até todas as chamadas que ela fizer terminarem.`
    const position = node.parent.children.indexOf(node)
    if (node.parent.fn !== node.fn) {
      return `<b>Outra função recursiva.</b> ${parentCall} (${node.parent.fn}) chamou ${call} (${node.fn}). Uma nova recursão começa aqui dentro; as chamadas dela aparecem como filhas.`
    }
    return `<b>Nova chamada.</b> ${parentCall} chamou ${call} — é a <b>${ordinal(position)} chamada recursiva</b> dela${
      node.line ? ` (linha ${node.line})` : ''
    }. Profundidade ${node.depth}: agora há ${node.depth + 1} chamadas empilhadas.`
  }

  if (event.t === 't') return `<b>Erro.</b> ${call} lançou: ${code(event.msg)}. O erro sobe para quem chamou.`

  const value = code(event.v.f)
  const destination = parentCall ? `devolve ${value} para ${parentCall}` : `devolve ${value} como resultado final`
  const next = trace.events[step]
  const hasNext = next && next.t === 'c' && node.parent && next.parent === node.parent.id
  const followUp = hasNext ? ` Em seguida ${parentCall} faz a ${ordinal(node.parent.children.length)} chamada recursiva.` : ''

  if (node.children.length === 0) {
    return `<b>🛑 Caso base.</b> ${call} não precisou chamar ninguém e ${destination}.${followUp}`
  }
  const parts = node.children.map((child) => child.value && child.kind === 'return' ? child.value.s : '✖').join(', ')
  return `<b>Voltando.</b> Todas as ${node.children.length} chamadas filhas de ${call} terminaram (resultados: ${code(parts)}). Combinando, ela ${destination}.${followUp}`
}

function renderSummary(step) {
  const trace = state.trace
  if (step !== trace.events.length) {
    elements.summary.innerHTML = ''
    return
  }
  const root = trace.rootNode
  const result = root.kind === 'return' ? code(root.value.f) : `erro ${code(root.message)}`
  const truncated = state.data.truncated ? ' ⚠ trace truncado (muitas chamadas): a árvore mostra só o início.' : ''
  elements.summary.innerHTML = `🏁 <b>Fim.</b> ${trace.total} chamadas · profundidade máxima ${trace.maxDepth} · resultado ${result}.${truncated}`
}

/* ---------- painéis laterais ---------- */

const MAX_RETURN_CHIPS = 60

function renderReturns(step) {
  const chips = []
  for (let index = step - 1; index >= 0 && chips.length < MAX_RETURN_CHIPS; index--) {
    const event = state.trace.events[index]
    if (event.t === 'c') continue
    const node = state.trace.nodes.get(event.id)
    const chip = document.createElement('span')
    const failed = event.t === 't'
    chip.className = `retChip${failed ? ' error' : ''}${node.isBase ? ' base' : ''}${chips.length === 0 ? ' latest' : ''}`
    const outcome = failed ? `✖ ${shorten(event.msg, 30)}` : event.v.s
    chip.innerHTML = `${node.isBase ? '🛑 ' : ''}${escapeHtml(shorten(callText(node, 's'), 36))} → <b>${escapeHtml(outcome)}</b>`
    chip.title = failed ? event.msg : `${callText(node, 'f')} retornou ${event.v.f}`
    chip.addEventListener('click', () => goTo(index + 1, true))
    chips.push(chip)
  }
  if (!chips.length) {
    const empty = document.createElement('i')
    empty.textContent = 'nenhuma chamada retornou ainda'
    chips.push(empty)
  }
  elements.returnChips.replaceChildren(...chips)
  elements.returnChips.scrollLeft = 0
}

function renderStack(focus, lastEvent) {
  elements.stack.replaceChildren()
  if (!focus) return
  const start = lastEvent.t === 'c' ? focus : focus.parent
  const frames = []
  for (let node = start; node; node = node.parent) frames.push(node)

  const visible = frames.slice(0, 30)
  visible.forEach((node, index) => {
    const frame = document.createElement('div')
    frame.className = `frame${index === 0 ? ' top' : ''}`
    frame.innerHTML = `<code>${escapeHtml(shorten(callText(node, 's'), 36))}</code><small>${index === 0 ? 'executando' : 'esperando'}</small>`
    elements.stack.append(frame)
  })
  if (frames.length > visible.length) {
    const rest = document.createElement('div')
    rest.className = 'frame'
    rest.textContent = `… e mais ${frames.length - visible.length} abaixo`
    elements.stack.append(rest)
  }
  if (!frames.length) elements.stack.innerHTML = '<i>vazia — tudo terminou</i>'
}

function renderVars(focus, lastEvent) {
  const lines = []
  if (focus) {
    focus.args.forEach((arg, index) => {
      const param = (state.data.functionParams[focus.fn] || [])[index] || `arg${index}`
      lines.push(`<div class="var"><b>${escapeHtml(param)}</b> = ${escapeHtml(arg.f)}</div>`)
    })
    if (lastEvent.t === 'r') lines.push(`<div class="var"><b>retorno</b> = ${escapeHtml(focus.value.f)}</div>`)
  }
  elements.vars.innerHTML = lines.join('') || '<i>—</i>'
}

function buildLog(trace) {
  elements.log.replaceChildren()
  trace.events.forEach((event, index) => {
    const node = trace.nodes.get(event.id)
    const row = document.createElement('div')
    row.className = 'row'
    row.style.paddingLeft = `${4 + Math.min(node.depth, 20) * 10}px`
    if (event.t === 'c') row.textContent = `▶ ${callText(node, 's')}`
    if (event.t === 'r') row.textContent = `◀ ${callText(node, 's')} → ${event.v.s}`
    if (event.t === 't') row.textContent = `✖ ${event.msg}`
    row.addEventListener('click', () => goTo(index + 1, true))
    elements.log.append(row)
  })
}

function renderLog(previousStep, step) {
  const rows = elements.log.children
  const from = Math.max(0, Math.min(previousStep, step) - 2)
  const to = Math.min(rows.length - 1, Math.max(previousStep, step) + 1)
  for (let index = from; index <= to; index++) {
    rows[index].classList.toggle('past', index < step)
    rows[index].classList.toggle('current', index === step - 1)
  }
  if (step > 0 && rows[step - 1]) rows[step - 1].scrollIntoView({ block: 'nearest' })
}

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
  renderVars(focus, lastEvent)
  renderLog(previousStep, step)

  elements.slider.value = step
  elements.counter.textContent = `passo ${step} / ${trace.events.length}`
  vscode.postMessage({ type: 'line', line: lastEvent && focus ? focus.line || state.data.fnLine : null })
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
    const result = last.t === 'r' ? last.v.s : last.t === 't' ? 'erro' : '…'
    const option = document.createElement('option')
    option.value = index
    option.textContent = shorten(`#${index + 1}: ${first.fn}(${first.args.map((arg) => arg.s).join(', ')}) → ${result}`, 60)
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
for (const control of [elements.showExplain, elements.showReturns, elements.showSidebar, elements.modeSelect, elements.speedSelect]) {
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
  if (event.key === ' ') { event.preventDefault(); togglePlay() }
  if (event.key === 'ArrowRight') goTo(state.step + 1, true)
  if (event.key === 'ArrowLeft') goTo(state.step - 1, true)
})
window.addEventListener('message', (event) => {
  if (event.data.type === 'data') load(event.data.payload)
})
vscode.postMessage({ type: 'ready' })
