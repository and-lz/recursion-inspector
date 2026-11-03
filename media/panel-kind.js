/* ---------- tipo da recursão ---------- */

// Id em inglês (vindo de src/classify.js), rótulo em português. O motivo de cada rótulo
// (`why`) vem da análise do código da função.
const RECURSION_KINDS = {
  linear: 'linear',
  binary: 'binária',
  multiple: 'múltipla',
  mutual: 'mútua',
  tail: 'de cauda',
  'top-down': 'top-down',
  'bottom-up': 'bottom-up',
  'pre-order': 'pré-ordem',
  'in-order': 'em ordem',
  'post-order': 'pós-ordem',
}

// Cada rótulo com o motivo específico: o trecho do código da função que o causou.
function recursionKinds(recursion) {
  if (!recursion) return []
  const ids = [
    recursion.shape,
    recursion.tail ? 'tail' : null,
    recursion.direction,
    ...recursion.orders,
  ]
  return ids.filter(Boolean).map((id) => ({ label: RECURSION_KINDS[id], hint: recursion.why[id] }))
}

// Chips sob o título e, na legenda, o mesmo vocabulário no formato "nome (motivo)".
function renderKinds(recursion) {
  const kinds = recursionKinds(recursion)
  elements.kinds.hidden = kinds.length === 0
  elements.kinds.replaceChildren(
    ...kinds.map((kind) => {
      const chip = document.createElement('span')
      chip.className = 'chip kind'
      chip.textContent = kind.label
      chip.title = kind.hint.replaceAll('`', '')
      return chip
    }),
  )

  const title = document.createElement('span')
  title.className = 'title'
  title.textContent = 'Recursão'
  elements.kindLegend.replaceChildren(
    ...(kinds.length ? [title] : []),
    ...kinds.map((kind) => {
      const chip = document.createElement('span')
      chip.className = 'chip kind'
      chip.innerHTML = `${escapeHtml(kind.label)}: ${withCode(kind.hint)}`
      return chip
    }),
  )
}
