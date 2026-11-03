/* ---------- tipo da recursão ---------- */

const SHAPE_KINDS = {
  linear: {
    label: 'linear',
    hint: 'uma chamada recursiva por execução: a recursão é uma linha reta.',
  },
  binária: { label: 'binária', hint: 'duas chamadas recursivas: a árvore de chamadas se bifurca.' },
  múltipla: {
    label: 'múltipla',
    hint: 'várias chamadas (ou chamada dentro de laço/callback): ramifica em muitos filhos.',
  },
  mútua: {
    label: 'mútua',
    hint: 'não chama a si mesma direto: chama outra função que volta para ela.',
  },
}

const DIRECTION_KINDS = {
  'top-down': {
    label: 'top-down',
    hint: 'o estado desce pelos parâmetros; a chamada não usa o que os filhos devolvem.',
  },
  'bottom-up': {
    label: 'bottom-up',
    hint: 'a resposta é montada na volta, combinando o que os filhos devolveram.',
  },
}

const ORDER_KINDS = {
  'pré-ordem': { label: 'pré-ordem', hint: 'faz trabalho ANTES da chamada recursiva (na ida).' },
  'em ordem': { label: 'em ordem', hint: 'faz trabalho ENTRE duas chamadas recursivas.' },
  'pós-ordem': { label: 'pós-ordem', hint: 'faz trabalho DEPOIS da volta dos filhos.' },
}

const TAIL_KIND = {
  label: 'de cauda',
  hint: 'a chamada recursiva é a última coisa que a função faz (`return f(...)`): nada a combinar na volta.',
}

function recursionKinds(recursion) {
  if (!recursion) return []
  return [
    SHAPE_KINDS[recursion.shape],
    recursion.tail ? TAIL_KIND : null,
    DIRECTION_KINDS[recursion.direction],
    ...recursion.orders.map((order) => ORDER_KINDS[order]),
  ].filter(Boolean)
}

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
}
