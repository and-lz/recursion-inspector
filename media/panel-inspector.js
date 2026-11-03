/* ---------- hover enxuto e inspetor ---------- */

function briefOutcome(node, stateName) {
  if (stateName === 'error')
    return tipSection('Erro', escapeHtml(shorten(node.message, 120)), 'failed')
  if (stateName !== 'done' && stateName !== 'returning') return ''
  const value = highlight(shorten(node.value.f, 120))
  return tipSection('Retorno', `<div class="tipResult">${value}</div>`)
}

// Versão enxuta para o hover: o detalhe completo fica no inspetor.
function describeNodeBrief(node, step) {
  const lastEvent = step > 0 ? state.trace.events[step - 1] : null
  const stateName = nodeState(node, step, lastEvent)
  const returned = stateName === 'done' || stateName === 'returning'
  const meta = [
    node.line ? `chamada na linha ${node.line}` : null,
    `profundidade ${node.depth}`,
    returned && node.isBase ? 'caso base' : null,
  ].filter(Boolean)
  return [
    `<header class="tipHead">${code(shorten(callText(node, 'f'), 120))}<span class="tipState ${stateName}">${STATE_LABELS[stateName]}</span></header>`,
    `<div class="tipMeta">${meta.join(' · ')}</div>`,
    briefOutcome(node, stateName),
    '<div class="tipNote">clique no nó para abrir o detalhe na lateral; o farol entra nos estados</div>',
  ].join('')
}

// Reaplica a classe do nó para ligar/desligar o brilho de "em inspeção".
function markNode(node) {
  if (!node) return
  const lastEvent = state.step > 0 ? state.trace.events[state.step - 1] : null
  updateNodeClass(node, nodeState(node, state.step, lastEvent))
}

function openInspector(node) {
  const previous = state.inspected
  if (previous === node && !elements.inspectorBox.hidden) return
  state.inspected = node
  markNode(previous)
  markNode(node)
  elements.inspectorBox.hidden = false
  renderInspector()
  elements.inspector.scrollTop = 0
}

function toggleInspector(node) {
  if (state.inspected === node && !elements.inspectorBox.hidden) closeInspector()
  else openInspector(node)
}

function closeInspector() {
  const previous = state.inspected
  state.inspected = null
  if (state.trace) markNode(previous)
  elements.inspectorBox.hidden = true
}

function renderInspector() {
  if (!state.inspected) return
  elements.inspector.innerHTML = describeNode(state.inspected, state.step)
}
