// Folhas ocupam slots consecutivos; cada pai fica no meio dos filhos.
function assignSlots(trace) {
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
  return { order, leaves }
}

function textWidth(node) {
  const length = Math.min(labelText(node).length, labelLimit(node))
  return Math.max(length, 10) * NODE_WIDTH_CHAR + 32
}

// Largura uniforme dos nós; a raiz pode ser mais larga que as demais.
function widestNode(order) {
  return order.reduce(
    (max, node) => (node.parent ? Math.max(max, textWidth(node)) : max),
    10 * NODE_WIDTH_CHAR + 32,
  )
}

function availableWidth() {
  return Math.max(elements.treeWrap.clientWidth - SCROLLBAR_ALLOWANCE, MIN_AVAILABLE_WIDTH)
}

// Em pé: folhas lado a lado, profundidade para baixo.
function arrangeUpright(order, leaves, levels, size) {
  const { nodeWidth, margin, top, compact } = size
  const slotStep = nodeWidth + (compact ? DOT_GAP : SLOT_GAP)
  const levelStep = compact ? DOT_SIZE + DOT_LEVEL_GAP : NODE_HEIGHT + LEVEL_GAP
  for (const node of order) {
    node.x = margin + node.slot * slotStep
    node.y = top + node.depth * levelStep
  }
  // Raiz mais larga continua centrada no mesmo ponto; se vazar pela esquerda, a árvore inteira desloca.
  const root = order[0]
  root.x -= (root.width - nodeWidth) / 2
  const shift = Math.max(0, margin - root.x)
  if (shift) for (const node of order) node.x += shift
  return {
    width: Math.max(margin * 2 + leaves * slotStep + shift, root.x + root.width + margin),
    height: top + margin + levels * levelStep,
    edgeGap: (nodeWidth + SLOT_GAP) / 2,
  }
}

// Em lista indentada: um nó por linha (ordem de visita), recuo por profundidade. A largura
// não depende do número de nós: o recuo encolhe até a árvore caber, e a rolagem é só vertical.
function arrangeOutline(trace, order, size) {
  const { nodeWidth, margin, top, compact } = size
  const levels = trace.maxDepth + 1
  const rowStep = compact ? DOT_SIZE + DOT_GAP : NODE_HEIGHT + OUTLINE_ROW_GAP
  const room = availableWidth() - margin * 2 - nodeWidth - EDGE_LABEL_WIDTH
  const maxIndent = compact ? DOT_SIZE + DOT_LEVEL_GAP : OUTLINE_INDENT
  const indent = Math.max(OUTLINE_MIN_INDENT, Math.min(maxIndent, room / levels))
  trace.indent = indent

  let row = 0
  const pending = [trace.rootNode]
  while (pending.length) {
    const node = pending.pop()
    node.x = margin + node.depth * indent
    node.y = top + row++ * rowStep
    for (let index = node.children.length - 1; index >= 0; index--)
      pending.push(node.children[index])
  }
  return {
    width:
      margin * 2 +
      (levels - 1) * indent +
      nodeWidth +
      EDGE_LABEL_WIDTH +
      (trace.rootNode.width - nodeWidth),
    height: top + margin + order.length * rowStep,
    edgeGap: EDGE_LABEL_WIDTH,
  }
}

// Nunca há rolagem horizontal em 100%: se a árvore em pé não cabe na largura, vira lista
// indentada (com texto, um nó por linha) em vez de encolher o desenho.
// Zoom baixo troca o desenho: nós viram quadradinhos e o espaçamento encolhe de verdade.
function layout(trace) {
  const { order, leaves } = assignSlots(trace)
  const compact = isCompact()
  const size = {
    nodeWidth: compact ? DOT_SIZE : widestNode(order),
    margin: compact ? DOT_MARGIN : MARGIN,
    top: compact ? DOT_MARGIN : TOP_MARGIN,
    compact,
  }
  const root = trace.rootNode
  for (const node of order) node.width = size.nodeWidth
  if (!compact) root.width = Math.max(size.nodeWidth, textWidth(root))
  const upright = arrangeUpright(order, leaves, trace.maxDepth + 1, size)
  trace.outline = upright.width > availableWidth()
  const result = trace.outline ? arrangeOutline(trace, order, size) : upright
  return { ...result, nodeWidth: size.nodeWidth, order }
}

function nodeHeight(node) {
  if (isCompact()) return DOT_SIZE
  return node.kind === 'throw' ? NODE_HEIGHT : COMPACT_HEIGHT
}

function placeNode(node) {
  node.height = nodeHeight(node)
  const tall = node.height === NODE_HEIGHT
  node.element.setAttribute('transform', `translate(${node.x},${node.y})`)
  node.rect.setAttribute('width', node.width)
  node.rect.setAttribute('height', node.height)
  node.tag.setAttribute('cy', tall ? 12 : 14)
  node.label.setAttribute('y', tall ? 16 : 18)
  if (node.badges) node.badges.setAttribute('transform', `translate(0,${tall ? 16 : 18})`)
  // O farol depende do tamanho do nó: some e é remontado no próximo hover.
  if (node.picker) node.picker.remove()
  node.picker = null
}

// Em pé: sai da base do pai e chega no topo do filho. Em lista: cotovelo do tronco do pai até
// o filho, com o valor devolvido à direita do nó.
function edgeGeometry(node) {
  const parent = node.parent
  if (state.trace.outline) {
    const trunkX = parent.x + state.trace.indent / 2
    const endY = node.y + node.height / 2
    return {
      path: `M${trunkX},${parent.y + parent.height} V${endY} H${node.x}`,
      labelX: node.x + node.width + EDGE_LABEL_WIDTH / 2,
      labelY: endY + 4,
    }
  }
  const startX = parent.x + parent.width / 2
  const startY = parent.y + parent.height
  const endX = node.x + node.width / 2
  const middleY = (startY + node.y) / 2
  return {
    path: `M${startX},${startY} C${startX},${middleY} ${endX},${middleY} ${endX},${node.y}`,
    labelX: (startX + endX) / 2,
    labelY: middleY + 4,
  }
}

function placeEdge(node) {
  // A raiz não tem pai nem seta: em pé, o retorno fica logo abaixo dela.
  if (!node.parent && !state.trace.outline) {
    node.edge.setAttribute('d', '')
    node.edgeValue.setAttribute('x', node.x + node.width / 2)
    node.edgeValue.setAttribute('y', node.y + node.height + ROOT_VALUE_DROP)
    return
  }
  if (!node.parent) {
    node.edge.setAttribute('d', '')
    node.edgeValue.setAttribute('x', node.x + node.width + EDGE_LABEL_WIDTH / 2)
    node.edgeValue.setAttribute('y', node.y + node.height / 2 + 4)
    return
  }
  const { path, labelX, labelY } = edgeGeometry(node)
  node.edge.setAttribute('d', path)
  node.edgeValue.setAttribute('x', labelX)
  node.edgeValue.setAttribute('y', labelY)
}

// Calcula o layout do modo atual e move os elementos que já existem.
function placeTree(trace) {
  const { nodeWidth, width, height, order, edgeGap } = layout(trace)
  state.treeSize = { width, height }
  trace.nodeWidth = nodeWidth

  // Rótulos de nós vizinhos ficam a ~metade do espaço entre eles: o texto cabe nessa folga.
  const edgeChars = Math.max(MIN_EDGE_CHARS, Math.floor(edgeGap / EDGE_CHAR_WIDTH) - 1)
  // Alturas primeiro: a aresta parte da base do pai.
  for (const node of order) {
    node.edgeChars = edgeChars
    placeNode(node)
  }
  for (const node of order) {
    placeEdge(node)
    if (node.edgeValue.textContent) node.edgeValue.textContent = edgeValueText(node, true)
  }
  applyZoom()
}
