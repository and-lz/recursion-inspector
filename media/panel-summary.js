/* ---------- resumo ---------- */

function subtreeSize(node) {
  return node.children.reduce((total, child) => total + subtreeSize(child), 1)
}

// Nós mostrados no resumo: os primeiros SUMMARY_HEAD, a raiz e seus filhos (caminho do retorno
// final) e os ancestrais de todos eles.
function summaryNodes(trace) {
  const ordered = [...trace.nodes.values()].sort(
    (first, second) => first.callIndex - second.callIndex,
  )
  const visible = new Set(ordered.slice(0, SUMMARY_HEAD))
  visible.add(trace.rootNode)
  for (const child of trace.rootNode.children) visible.add(child)
  for (const node of [...visible]) {
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) visible.add(ancestor)
  }
  return visible
}

// Resumo: mantém só os eventos dos nós visíveis, com retornos já calculados (cada nó guarda o
// valor do seu return). Pais com filhos cortados ganham `omitted`.
function summarizeTrace(trace) {
  const visible = summaryNodes(trace)
  const kept = []
  const newIndex = new Map()
  trace.events.forEach((event, index) => {
    if (!visible.has(trace.nodes.get(event.id))) return
    newIndex.set(index, kept.length)
    kept.push(event)
  })
  // Quantos eventos mantidos vêm antes de `at` (as sondas guardam posição em eventos).
  const keptBefore = (at) => {
    let count = 0
    for (const index of newIndex.keys()) {
      if (index >= at) break
      count++
    }
    return count
  }

  const nodes = new Map()
  for (const node of visible) {
    node.omitted = node.children
      .filter((child) => !visible.has(child))
      .reduce((total, child) => total + subtreeSize(child), 0)
    node.children = node.children.filter((child) => visible.has(child))
    node.callIndex = newIndex.get(node.callIndex)
    if (node.endIndex !== Infinity) node.endIndex = newIndex.get(node.endIndex)
    for (const entry of [...node.locals, ...node.conds]) entry.at = keptBefore(entry.at)
    nodes.set(node.id, node)
  }
  return {
    events: kept,
    nodes,
    rootNode: trace.rootNode,
    maxDepth: trace.maxDepth,
    total: trace.total,
  }
}
