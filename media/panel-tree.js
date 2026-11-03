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
    chip.style.setProperty('--dot', functionColor(name))
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

  const longest = order.reduce(
    (max, node) => Math.max(max, Math.min(argsText(node, 's').length, MAX_ARGS)),
    10,
  )
  const nodeWidth = longest * NODE_WIDTH_CHAR + 32
  const slotWidth = nodeWidth + SLOT_GAP
  for (const node of order) {
    node.x = MARGIN + node.slot * slotWidth
    node.y = TOP_MARGIN + node.depth * (NODE_HEIGHT + LEVEL_GAP)
  }
  return {
    nodeWidth,
    width: MARGIN * 2 + leaves * slotWidth,
    height: TOP_MARGIN + MARGIN + (trace.maxDepth + 1) * (NODE_HEIGHT + LEVEL_GAP),
    order,
  }
}

// Selo no canto do nó, visível só no hover; abre o inspetor na lateral.
function buildInspectButton(node, nodeWidth) {
  const button = svg('g', { class: 'inspectBtn', transform: `translate(${nodeWidth - 4},0)` })
  const title = svg('title')
  title.textContent = 'Inspecionar na lateral'
  const label = svg('text', { y: 4 })
  label.textContent = 'i'
  button.append(title, svg('circle', { r: 8 }), label)
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    openInspector(node)
  })
  return button
}

// Passo em que o nó está em cada estado; folha nunca espera filhos, então não tem esse estado.
function stateSteps(node) {
  const [firstChild] = node.children
  return [
    { name: 'active', label: 'chamando agora', step: node.callIndex + 1 },
    firstChild && {
      name: 'waiting',
      label: 'esperando os filhos',
      step: firstChild.callIndex + 1,
    },
    { name: 'done', label: 'já retornou', step: node.endIndex + 1 },
  ].filter(Boolean)
}

// Pílula com três bolinhas estilo semáforo do macOS, a cavalo na borda de baixo; só no hover.
// Cada bolinha pula direto para aquele estado.
function buildStatePicker(node, nodeWidth) {
  const steps = stateSteps(node)
  const pitch = STATE_DOT_RADIUS * 2 + STATE_DOT_GAP
  const pillWidth = (steps.length - 1) * pitch + STATE_DOT_RADIUS * 2 + STATE_PILL_PADDING * 2
  const pillHeight = STATE_DOT_RADIUS * 2 + 8
  const picker = svg('g', {
    class: 'statePicker',
    transform: `translate(${nodeWidth - pillWidth - 12},${node.height - pillHeight / 2})`,
  })
  picker.append(svg('rect', { width: pillWidth, height: pillHeight, rx: pillHeight / 2 }))
  steps.forEach((entry, index) => {
    const swatch = svg('g', {
      class: `stateSwatch ${entry.name}`,
      transform: `translate(${STATE_PILL_PADDING + STATE_DOT_RADIUS + index * pitch},${pillHeight / 2})`,
    })
    const title = svg('title')
    title.textContent = entry.label
    swatch.append(title, svg('circle', { r: STATE_DOT_RADIUS }))
    swatch.addEventListener('click', (event) => {
      event.stopPropagation()
      goTo(entry.step, true)
    })
    picker.append(swatch)
  })
  return picker
}

function buildNodeElement(node, nodeWidth, nodeLayer) {
  node.isBase = node.children.length === 0
  node.height = node.kind === 'throw' ? NODE_HEIGHT : COMPACT_HEIGHT
  node.element = svg('g', { class: 'node hidden', transform: `translate(${node.x},${node.y})` })
  node.element.append(svg('rect', { width: nodeWidth, height: node.height }))
  const tag = svg('circle', {
    class: 'tag',
    r: 4,
    cx: 12,
    cy: node.height === NODE_HEIGHT ? 12 : 14,
  })
  tag.style.fill = functionColor(node.fn)
  node.element.append(tag)
  const label = svg('text', { x: 22, y: node.height === NODE_HEIGHT ? 16 : 18 })
  label.textContent = shorten(argsText(node, 's'), MAX_ARGS)
  node.retText = svg('text', { x: 22, y: 31, class: 'ret' })
  node.element.append(label, node.retText)
  node.element.append(buildInspectButton(node, nodeWidth), buildStatePicker(node, nodeWidth))
  attachTooltip(node.element, node)
  node.element.addEventListener('click', () => goTo(node.callIndex + 1, true))
  nodeLayer.append(node.element)
  node.className = 'node hidden'
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

  // Rótulos de irmãos ficam a ~metade de um slot um do outro: o texto cabe nessa folga.
  const edgeChars = Math.max(
    MIN_EDGE_CHARS,
    Math.floor((nodeWidth + SLOT_GAP) / 2 / EDGE_CHAR_WIDTH) - 1,
  )

  for (const node of order) {
    node.edgeChars = edgeChars
    buildNodeElement(node, nodeWidth, nodeLayer)

    if (!node.parent) {
      node.edgeValue = svg('text', {
        class: 'edgeValue hidden',
        'text-anchor': 'middle',
        x: node.x + nodeWidth / 2,
        y: node.y - 6,
      })
      node.edgeValueClass = 'edgeValue hidden'
      attachTooltip(node.edgeValue, node, describeEdgeValue)
      valueLayer.append(node.edgeValue)
      continue
    }
    const startX = node.parent.x + nodeWidth / 2
    const startY = node.parent.y + node.parent.height
    const endX = node.x + nodeWidth / 2
    const middleY = (startY + node.y) / 2
    node.edge = svg('path', {
      class: 'edge hidden',
      d: `M${startX},${startY} C${startX},${middleY} ${endX},${middleY} ${endX},${node.y}`,
    })
    node.edgeClass = 'edge hidden'
    edgeLayer.append(node.edge)

    node.edgeValue = svg('text', {
      class: 'edgeValue hidden',
      'text-anchor': 'middle',
      x: (startX + endX) / 2,
      y: middleY + 4,
    })
    node.edgeValueClass = 'edgeValue hidden'
    attachTooltip(node.edgeValue, node, describeEdgeValue)
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
  if (node.kind !== 'throw') return ''
  return `✖ ${shorten(node.message, 22)}`
}

// Objeto/array que não cabe na aresta vira um resumo; o conteúdo fica no hover.
const COLLAPSED = { '{': '{}', '[': '[]' }

function edgeValueText(node, returned) {
  if (!returned) return ''
  if (node.kind === 'throw') return '✖'
  const text = node.value.s
  if (text.length <= node.edgeChars) return text
  const summary = COLLAPSED[text[0]]
  return summary ?? shorten(text, node.edgeChars)
}

function edgeDirection(node, lastEvent) {
  if (!lastEvent || lastEvent.id !== node.id) return ''
  return lastEvent.t === 'c' ? ' descending' : ' ascending'
}

function updateNodeClass(node, stateName) {
  const className = `node ${stateName}${node.isBase ? ' base' : ''}${node === state.inspected ? ' inspected' : ''}`
  if (className === node.className) return
  node.className = className
  node.element.setAttribute('class', className)
  node.retText.textContent = returnText(node, stateName)
}

function updateEdgeClass(node, stateName, lastEvent) {
  if (!node.edge) return
  const edgeClass = `edge${stateName === 'hidden' ? ' hidden' : ''}${edgeDirection(node, lastEvent)}`
  if (edgeClass === node.edgeClass) return
  node.edgeClass = edgeClass
  node.edge.setAttribute('class', edgeClass)
}

function updateEdgeValue(node, stateName) {
  const returned = stateName === 'done' || stateName === 'returning' || stateName === 'error'
  const className = `edgeValue${returned ? '' : ' hidden'}${stateName === 'returning' ? ' latest' : ''}${stateName === 'error' ? ' failed' : ''}`
  if (className === node.edgeValueClass) return
  node.edgeValueClass = className
  node.edgeValue.setAttribute('class', className)
  node.edgeValue.textContent = edgeValueText(node, returned)
}

function renderTree(step) {
  const trace = state.trace
  const lastEvent = step > 0 ? trace.events[step - 1] : null
  let focus = null

  for (const node of trace.nodes.values()) {
    const stateName = nodeState(node, step, lastEvent)
    updateNodeClass(node, stateName)
    if (stateName === 'active' || stateName === 'returning' || stateName === 'error') focus = node
    updateEdgeValue(node, stateName)
    updateEdgeClass(node, stateName, lastEvent)
  }

  if (focus) focus.element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return focus
}
