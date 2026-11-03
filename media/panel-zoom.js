// Maior escala em que a árvore compacta inteira cabe na área visível.
function fitScale() {
  const { width, height } = state.treeSize
  const wrap = elements.treeWrap
  return Math.min(1, wrap.clientWidth / width, wrap.clientHeight / height)
}

// No modo compacto, MIN_ZOOM mostra a árvore inteira de uma vez e LOW_DETAIL_ZOOM chega a 1:1.
function drawScale() {
  if (!isCompact()) return state.zoom
  const fit = fitScale()
  const progress = (state.zoom - MIN_ZOOM) / (LOW_DETAIL_ZOOM - MIN_ZOOM)
  return fit + progress * (1 - fit)
}

// Escala o desenho inteiro: nós e distâncias encolhem juntos, então ficam todos próximos.
// Abaixo de LOW_DETAIL_ZOOM o texto some e sobra só a forma da árvore.
function applyZoom() {
  const { width, height } = state.treeSize
  const scale = drawScale()
  elements.tree.setAttribute('width', width * scale)
  elements.tree.setAttribute('height', height * scale)
  state.viewport.setAttribute('transform', `scale(${scale})`)
  elements.tree.classList.toggle('lowDetail', isCompact())
  elements.zoomReset.textContent = `${Math.round(state.zoom * 100)}%`
}

// Pinça no trackpad chega como wheel com ctrlKey; mantém o ponto sob o cursor parado.
function zoomAt(event) {
  event.preventDefault()
  if (!state.viewport) return
  const wasCompact = isCompact()
  const oldZoom = state.zoom
  const newZoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, oldZoom * Math.exp(-event.deltaY * ZOOM_SPEED)),
  )
  if (newZoom === oldZoom) return
  const before = elements.tree.getBoundingClientRect()
  const fractionX = (event.clientX - before.left) / before.width
  const fractionY = (event.clientY - before.top) / before.height
  state.zoom = newZoom
  if (isCompact() === wasCompact) applyZoom()
  else rebuildTree()
  const after = elements.tree.getBoundingClientRect()
  elements.treeWrap.scrollLeft += after.left + fractionX * after.width - event.clientX
  elements.treeWrap.scrollTop += after.top + fractionY * after.height - event.clientY
}

function rebuildTree() {
  buildTree(state.trace)
  renderTree(state.step)
}

function resetZoom() {
  if (!state.viewport || state.zoom === 1) return
  const wasCompact = isCompact()
  state.zoom = 1
  if (wasCompact) rebuildTree()
  else applyZoom()
}
