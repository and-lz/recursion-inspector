function svg(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes || {})) element.setAttribute(name, value)
  return element
}

function functionColor(name) {
  const names = Object.keys(state.data.functionParams)
  const classes = document.body.classList
  const isLight = classes.contains('vscode-light') || classes.contains('vscode-high-contrast-light')
  const palette = isLight ? FN_COLORS_LIGHT : FN_COLORS_DARK
  return palette[names.indexOf(name) % palette.length]
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

function isCompact() {
  return state.zoom < LOW_DETAIL_ZOOM
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

// Pílula com as bolinhas estilo semáforo do macOS; cada uma pula direto para aquele estado.
// Usada no hover do nó e no topo do inspetor, igual nos dois.
function buildStateLights(node) {
  const steps = stateSteps(node)
  const pitch = STATE_DOT_RADIUS * 2 + STATE_DOT_GAP
  const width = (steps.length - 1) * pitch + STATE_DOT_RADIUS * 2 + STATE_PILL_PADDING * 2
  const height = STATE_DOT_RADIUS * 2 + 8
  const element = svg('g', { class: 'stateLights' })
  element.append(svg('rect', { class: 'statePill', width, height, rx: height / 2 }))
  steps.forEach((entry, index) => {
    const swatch = svg('g', {
      class: `stateSwatch ${entry.name}`,
      transform: `translate(${STATE_PILL_PADDING + STATE_DOT_RADIUS + index * pitch},${height / 2})`,
    })
    const title = svg('title')
    title.textContent = entry.label
    swatch.append(title, svg('circle', { r: STATE_DOT_RADIUS }))
    swatch.addEventListener('click', (event) => {
      event.stopPropagation()
      goTo(entry.step, true)
    })
    element.append(swatch)
  })
  return { element, width, height }
}

// No nó: a cavalo na borda de baixo, só no hover.
function buildStatePicker(node, nodeWidth) {
  const lights = buildStateLights(node)
  const picker = svg('g', {
    class: 'statePicker',
    transform: `translate(${(nodeWidth - lights.width) / 2},${node.height - lights.height / 2 + STATE_PILL_DROP})`,
  })
  picker.append(lights.element)
  return picker
}

// Raiz: cada valor precede de um badge discreto com o nome do parâmetro. O badge fica numa
// camada própria (`node.badges`) que `placeNode` alinha à linha de base do texto.
function buildRootLabel(node, budget, omittedText, textX) {
  node.badges = svg('g', { class: 'paramBadges' })
  let cursor = textX
  let remaining = budget
  for (const [index, arg] of node.args.entries()) {
    if (remaining <= 0) break
    const name = paramName(node, index)
    const badgeWidth = name.length * BADGE_CHAR_WIDTH + BADGE_PADDING * 2
    node.badges.append(
      svg('rect', { class: 'paramBadge', x: cursor, y: -11, width: badgeWidth, height: 15 }),
      Object.assign(svg('text', { class: 'paramName', x: cursor + BADGE_PADDING }), {
        textContent: name,
      }),
    )
    cursor += badgeWidth + BADGE_GAP
    const value = shorten(arg.s, remaining)
    const tspan = svg('tspan', { x: cursor })
    tspan.textContent = value
    node.label.append(tspan)
    cursor += value.length * NODE_WIDTH_CHAR + ARG_GAP
    remaining -= value.length
  }
  if (omittedText) {
    const tspan = svg('tspan', { x: cursor })
    tspan.textContent = omittedText.trim()
    node.label.append(tspan)
  }
}

// Cria os elementos de um nó sem geometria: `placeNode` posiciona (e reposiciona no zoom).
function buildNodeElement(node, nodeLayer, showTag) {
  node.isBase = node.children.length === 0 && !node.omitted
  node.element = svg('g', { class: 'node hidden' })
  node.rect = svg('rect')
  const textX = showTag ? 22 : 12
  node.tag = svg('circle', { class: 'tag', r: 4, cx: 12 })
  node.tag.style.fill = functionColor(node.fn)
  node.label = svg('text', { x: textX })
  const omittedText = node.omitted ? ` …+${node.omitted}` : ''
  const budget = labelLimit(node) - omittedText.length
  if (node.parent) node.label.textContent = shorten(labelText(node), budget) + omittedText
  else buildRootLabel(node, budget, omittedText, textX)
  node.retText = svg('text', { x: textX, y: 31, class: 'ret' })
  node.element.append(node.rect)
  if (showTag) node.element.append(node.tag)
  if (node.badges) node.element.append(node.badges)
  node.element.append(node.label, node.retText)
  // O farol só é montado no primeiro hover: com milhares de nós, montar todos custa caro.
  node.picker = null
  node.element.addEventListener('mouseenter', () => {
    if (node.picker) return
    node.picker = buildStatePicker(node, node.width)
    node.element.append(node.picker)
  })
  attachTooltip(node.element, node)
  node.element.addEventListener('click', () => showInspector(node))
  nodeLayer.append(node.element)
  node.className = 'node hidden'
}

function buildEdgeElements(node, edgeLayer, valueLayer) {
  node.edge = svg('path', { class: 'edge hidden' })
  node.edgeClass = 'edge hidden'
  edgeLayer.append(node.edge)
  node.edgeValue = svg('text', { class: 'edgeValue hidden', 'text-anchor': 'middle' })
  node.edgeValueClass = 'edgeValue hidden'
  attachTooltip(node.edgeValue, node, describeEdgeValue)
  valueLayer.append(node.edgeValue)
}

function buildTree(trace) {
  elements.tree.replaceChildren()
  const viewport = svg('g')
  const edgeLayer = svg('g')
  const nodeLayer = svg('g')
  const valueLayer = svg('g')
  viewport.append(edgeLayer, nodeLayer, valueLayer)
  elements.tree.append(viewport)
  state.viewport = viewport

  const { order } = layout(trace)
  // Com uma função só, a bolinha de cor não distingue nada: some e o texto sobe para a borda.
  const showTag = new Set(order.map((node) => node.fn)).size > 1
  for (const node of order) {
    buildNodeElement(node, nodeLayer, showTag)
    buildEdgeElements(node, edgeLayer, valueLayer)
  }
  placeTree(trace)
}
