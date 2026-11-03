/* ---------- papel do retorno ---------- */

// Papel de cada retorno na recursão, na ordem em que a classificação testa.
const RETURN_ROLES = {
  error: { label: 'erro', hint: 'a chamada lançou uma exceção em vez de retornar.' },
  undefined: {
    label: 'sem retorno',
    hint: 'a função terminou devolvendo `undefined` (falta um `return`?).',
  },
  memo: {
    label: 'memoizado',
    hint: 'mesmos argumentos de uma chamada anterior que já tinha recursado: veio de cache, sem recursão.',
  },
  base: { label: 'caso base', hint: 'devolveu direto, sem chamar ninguém.' },
  propagated: {
    label: 'propagado',
    hint: 'devolveu o mesmo valor que um dos filhos (escolheu ou repassou): típico de cauda e top-down.',
  },
  combined: {
    label: 'combinado',
    hint: 'calculou um valor novo a partir dos filhos (soma, max, &&...): típico de bottom-up.',
  },
}

// Função sem `return` útil (DFS, backtracking...): `undefined` em todo lugar não indica bug.
function returnsNothing(nodes) {
  const returned = [...nodes.values()].filter((node) => node.kind === 'return')
  return returned.length > 0 && returned.every((node) => node.value.s === 'undefined')
}

// Mesmos argumentos de uma chamada anterior, já encerrada, que recursou: o valor veio de cache.
function isMemoHit(node, recursed) {
  if (node.children.length > 0) return false
  return recursed.has(`${node.fn}(${argsText(node, 'f')})`)
}

function classifyReturn(node, recursed, voidFn) {
  if (node.kind === 'throw') return 'error'
  if (!voidFn && node.value.s === 'undefined') return 'undefined'
  if (isMemoHit(node, recursed)) return 'memo'
  if (node.children.length === 0) return 'base'
  const repeated = node.children.some(
    (child) => child.kind === 'return' && child.value.f === node.value.f,
  )
  return repeated ? 'propagated' : 'combined'
}

function assignRoles(nodes) {
  const voidFn = returnsNothing(nodes)
  const recursed = new Set()
  for (const node of nodes.values()) {
    node.role = classifyReturn(node, recursed, voidFn)
    if (node.children.length > 0) recursed.add(`${node.fn}(${argsText(node, 'f')})`)
  }
}
