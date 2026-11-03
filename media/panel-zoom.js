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

const ZOOM_IDLE_MS = 150
const pendingZoom = { deltaY: 0, clientX: 0, clientY: 0, frame: null, idleTimer: null }

// Pinça no trackpad chega como wheel com ctrlKey. Os eventos de um quadro viram um só zoom:
// cada um refaria o layout da árvore inteira.
function zoomAt(event) {
  event.preventDefault()
  if (!state.viewport) return
  pendingZoom.deltaY += event.deltaY
  pendingZoom.clientX = event.clientX
  pendingZoom.clientY = event.clientY
  if (pendingZoom.frame !== null) return
  pendingZoom.frame = requestAnimationFrame(applyPendingZoom)
}

// Durante o gesto, sombras e transições saem (custam por nó); voltam quando o gesto para.
function markZooming() {
  elements.tree.classList.add('zooming')
  clearTimeout(pendingZoom.idleTimer)
  pendingZoom.idleTimer = setTimeout(() => elements.tree.classList.remove('zooming'), ZOOM_IDLE_MS)
}

// Mantém o ponto sob o cursor parado.
function applyPendingZoom() {
  const { deltaY, clientX, clientY } = pendingZoom
  pendingZoom.frame = null
  pendingZoom.deltaY = 0
  const wasCompact = isCompact()
  const oldZoom = state.zoom
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * Math.exp(-deltaY * ZOOM_SPEED)))
  if (newZoom === oldZoom) return
  markZooming()
  const before = elements.tree.getBoundingClientRect()
  const fractionX = (clientX - before.left) / before.width
  const fractionY = (clientY - before.top) / before.height
  state.zoom = newZoom
  if (isCompact() === wasCompact) applyZoom()
  else relayoutTree()
  const after = elements.tree.getBoundingClientRect()
  elements.treeWrap.scrollLeft += after.left + fractionX * after.width - clientX
  elements.treeWrap.scrollTop += after.top + fractionY * after.height - clientY
}

// Troca de modo (detalhe/compacto): só reposiciona, os elementos continuam os mesmos.
function relayoutTree() {
  placeTree(state.trace)
}

// Sempre leva o viewport ao último nó do passo atual (a raiz, se nada rodou ainda).
function resetZoom() {
  if (!state.viewport) return
  const wasCompact = isCompact()
  state.zoom = 1
  if (wasCompact) relayoutTree()
  else applyZoom()
  const lastEvent = state.step > 0 ? state.trace.events[state.step - 1] : null
  const node = lastEvent ? state.trace.nodes.get(lastEvent.id) : state.trace.rootNode
  node.element.scrollIntoView({ block: 'center', inline: 'center' })
}
