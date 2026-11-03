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

// Só mudam de estado os nós com evento entre os dois passos (mais os dois últimos eventos).
// Salto grande (slider) sai mais barato com a varredura completa.
function changedNodes(trace, previousStep, step) {
  const low = Math.max(0, Math.min(previousStep, step) - 1)
  const high = Math.min(trace.events.length, Math.max(previousStep, step)) - 1
  if (high - low + 1 > trace.nodes.size) return trace.nodes.values()
  const changed = new Set()
  for (let index = low; index <= high; index++) changed.add(trace.nodes.get(trace.events[index].id))
  return changed
}

// Sem `previousStep`, redesenha todos os nós (árvore recém-construída).
function renderTree(step, previousStep) {
  const trace = state.trace
  const lastEvent = step > 0 ? trace.events[step - 1] : null
  const nodes =
    previousStep === undefined ? trace.nodes.values() : changedNodes(trace, previousStep, step)

  for (const node of nodes) {
    const stateName = nodeState(node, step, lastEvent)
    updateNodeClass(node, stateName)
    updateEdgeValue(node, stateName)
    updateEdgeClass(node, stateName, lastEvent)
  }

  const focus = lastEvent ? trace.nodes.get(lastEvent.id) : null
  if (focus) focus.element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return focus
}
