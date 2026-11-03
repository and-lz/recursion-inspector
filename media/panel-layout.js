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

function widestNode(order) {
  const longest = order.reduce(
    (max, node) => Math.max(max, Math.min(argsText(node, 's').length, MAX_ARGS)),
    10,
  )
  return longest * NODE_WIDTH_CHAR + 32
}

// Zoom baixo troca o desenho: nós viram quadradinhos e o espaçamento encolhe de verdade,
// em vez de só escalar o layout largo (que deixaria tudo esparso e ilegível).
// Árvore muito mais larga que alta (muitas folhas) gira: profundidade no eixo X, folhas
// empilhadas no Y, e a rolagem passa a ser vertical.
function layout(trace) {
  const { order, leaves } = assignSlots(trace)
  const compact = isCompact()
  const nodeWidth = compact ? DOT_SIZE : widestNode(order)
  const margin = compact ? DOT_MARGIN : MARGIN
  const top = compact ? DOT_MARGIN : TOP_MARGIN
  const levels = trace.maxDepth + 1

  const upright = {
    slotStep: nodeWidth + (compact ? DOT_GAP : SLOT_GAP),
    levelStep: compact ? DOT_SIZE + DOT_LEVEL_GAP : NODE_HEIGHT + LEVEL_GAP,
  }
  const width = margin * 2 + leaves * upright.slotStep
  const height = top + margin + levels * upright.levelStep
  const horizontal = width > height * ASPECT_LIMIT

  trace.horizontal = horizontal
  if (!horizontal) {
    for (const node of order) {
      node.x = margin + node.slot * upright.slotStep
      node.y = top + node.depth * upright.levelStep
    }
    return { nodeWidth, width, height, order, edgeGap: (nodeWidth + SLOT_GAP) / 2 }
  }

  const levelStep = nodeWidth + (compact ? DOT_LEVEL_GAP : LEVEL_GAP_X)
  const slotStep = compact ? DOT_SIZE + DOT_GAP : NODE_HEIGHT + SLOT_GAP_Y
  for (const node of order) {
    node.x = margin + node.depth * levelStep
    node.y = top + node.slot * slotStep
  }
  return {
    nodeWidth,
    width: margin * 2 + levels * levelStep,
    height: top + margin + leaves * slotStep,
    order,
    edgeGap: LEVEL_GAP_X,
  }
}

function nodeHeight(node) {
  if (isCompact()) return DOT_SIZE
  return node.kind === 'throw' ? NODE_HEIGHT : COMPACT_HEIGHT
}

function placeNode(node, nodeWidth) {
  node.height = nodeHeight(node)
  const tall = node.height === NODE_HEIGHT
  node.element.setAttribute('transform', `translate(${node.x},${node.y})`)
  node.rect.setAttribute('width', nodeWidth)
  node.rect.setAttribute('height', node.height)
  node.tag.setAttribute('cy', tall ? 12 : 14)
  node.label.setAttribute('y', tall ? 16 : 18)
  // O farol depende do tamanho do nó: some e é remontado no próximo hover.
  if (node.picker) node.picker.remove()
  node.picker = null
}

// Vertical: sai da base do pai e chega no topo do filho. Horizontal: da direita para a esquerda.
function edgeGeometry(node, nodeWidth) {
  const parent = node.parent
  if (state.trace.horizontal) {
    const startX = parent.x + nodeWidth
    const startY = parent.y + parent.height / 2
    const endY = node.y + node.height / 2
    const middleX = (startX + node.x) / 2
    return {
      path: `M${startX},${startY} C${middleX},${startY} ${middleX},${endY} ${node.x},${endY}`,
      labelX: middleX,
      labelY: (startY + endY) / 2 - 4,
    }
  }
  const startX = parent.x + nodeWidth / 2
  const startY = parent.y + parent.height
  const endX = node.x + nodeWidth / 2
  const middleY = (startY + node.y) / 2
  return {
    path: `M${startX},${startY} C${startX},${middleY} ${endX},${middleY} ${endX},${node.y}`,
    labelX: (startX + endX) / 2,
    labelY: middleY + 4,
  }
}

function placeEdge(node, nodeWidth) {
  if (!node.parent) {
    node.edgeValue.setAttribute('x', node.x + nodeWidth / 2)
    node.edgeValue.setAttribute('y', node.y - 6)
    return
  }
  const { path, labelX, labelY } = edgeGeometry(node, nodeWidth)
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
    placeNode(node, nodeWidth)
  }
  for (const node of order) {
    placeEdge(node, nodeWidth)
    if (node.edgeValue.textContent) node.edgeValue.textContent = edgeValueText(node, true)
  }
  applyZoom()
}
