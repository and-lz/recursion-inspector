/* ---------- tipo da recursão ---------- */

// Mesmo formato dos papéis de retorno: id em inglês, `label` e `hint` em português.
const RECURSION_KINDS = {
  linear: { label: 'linear', hint: 'uma chamada recursiva por execução' },
  binary: { label: 'binária', hint: 'duas chamadas recursivas: a árvore se bifurca' },
  multiple: {
    label: 'múltipla',
    hint: 'três ou mais chamadas, ou chamada dentro de laço ou callback',
  },
  mutual: { label: 'mútua', hint: 'chama outra função que volta para ela' },
  tail: {
    label: 'de cauda',
    hint: 'a chamada é a última coisa que a função faz (`return f(...)`)',
  },
  'top-down': {
    label: 'top-down',
    hint: 'o estado desce pelos parâmetros; não usa o que os filhos devolvem',
  },
  'bottom-up': {
    label: 'bottom-up',
    hint: 'monta a resposta na volta, combinando o que os filhos devolveram',
  },
  'pre-order': { label: 'pré-ordem', hint: 'trabalho antes da chamada recursiva (na ida)' },
  'in-order': { label: 'em ordem', hint: 'trabalho entre duas chamadas recursivas' },
  'post-order': { label: 'pós-ordem', hint: 'trabalho depois da volta dos filhos' },
}

function recursionKinds(recursion) {
  if (!recursion) return []
  const ids = [
    recursion.shape,
    recursion.tail ? 'tail' : null,
    recursion.direction,
    ...recursion.orders,
  ]
  return ids.filter(Boolean).map((id) => RECURSION_KINDS[id])
}

// Chips sob o título e, na legenda, o mesmo vocabulário no formato "nome (descrição)".
function renderKinds(recursion) {
  const kinds = recursionKinds(recursion)
  elements.kinds.hidden = kinds.length === 0
  elements.kinds.replaceChildren(
    ...kinds.map((kind) => {
      const chip = document.createElement('span')
      chip.className = 'chip kind'
      chip.textContent = kind.label
      chip.title = kind.hint
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
      chip.textContent = `${kind.label} (${kind.hint})`
      return chip
    }),
  )
}
