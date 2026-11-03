/* ---------- papel do retorno ---------- */

// Papel de cada retorno na recursão, na ordem em que a classificação testa. `hint` explica,
// com os valores desta chamada, por que ela recebeu esse papel.
const RETURN_ROLES = {
  error: {
    label: 'erro',
    hint: (node) => `${callText(node, 's')} lançou ${node.message} em vez de retornar.`,
  },
  undefined: {
    label: 'sem retorno',
    hint: (node) => `${callText(node, 's')} terminou devolvendo undefined (falta um return?).`,
  },
  memo: {
    label: 'memoizado',
    hint: (node) =>
      `${callText(node, 's')} repete os argumentos de uma chamada anterior que já tinha recursado: devolveu ${node.value.s} do cache, sem recursão.`,
  },
  base: {
    label: 'caso base',
    hint: (node) => `devolveu ${node.value.s} direto, sem chamar ninguém.`,
  },
  propagated: {
    label: 'top-down',
    hint: (node) => {
      const source = node.children.find((child) => child.value && child.value.f === node.value.f)
      return `devolveu ${node.value.s}, o mesmo valor de ${callText(source, 's')}: repassou o resultado do filho sem montar nada na volta.`
    },
  },
  combined: {
    label: 'bottom-up',
    hint: (node) => {
      const parts = node.children.map((child) => (child.value ? child.value.s : '✖')).join(', ')
      return `devolveu ${node.value.s}, montado na volta a partir dos filhos (${parts}).`
    },
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
