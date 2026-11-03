/* ---------- papel do retorno ---------- */

// O `return` real da função (com o trecho devolvido em destaque), quando há, no começo da frase.
function returnPart(node) {
  return node.returnSrc ? `${returnCode(node)} ` : ''
}

// Papel de cada retorno na recursão, na ordem em que a classificação testa. `hint` explica,
// em HTML, com o código e os valores desta chamada, por que ela recebeu esse papel; `brief` é a
// versão de uma linha, para o inspetor (que já mostra o return e o valor).
const RETURN_ROLES = {
  error: {
    label: 'erro',
    hint: (node) => `${code(callText(node, 's'))} lançou ${code(node.message)} em vez de retornar.`,
  },
  undefined: {
    label: 'sem retorno',
    brief: () => `falta um ${code('return')}?`,
    hint: (node) =>
      `${code(callText(node, 's'))} terminou devolvendo ${code('undefined')}: falta um ${code('return')}?`,
  },
  memo: {
    label: 'memoizado',
    brief: () => 'argumentos repetidos: veio do cache.',
    hint: (node) =>
      `${code(callText(node, 's'))} repete os argumentos de uma chamada anterior que já tinha recursado: ${returnPart(node)}devolveu ${code(node.value.s)} do cache, sem recursão.`,
  },
  base: {
    label: 'caso base',
    brief: () => 'sem chamar ninguém.',
    hint: (node) => `${returnPart(node)}devolveu ${code(node.value.s)} direto, sem chamar ninguém.`,
  },
  propagated: {
    label: 'top-down',
    brief: () => 'repassou o resultado de um filho.',
    hint: (node) => {
      const source = node.children.find((child) => child.value && child.value.f === node.value.f)
      return `${returnPart(node)}devolveu ${code(node.value.s)}, o mesmo valor de ${code(callText(source, 's'))}: repassou o resultado do filho sem montar nada na volta.`
    },
  },
  combined: {
    label: 'bottom-up',
    brief: () => 'montado com os retornos dos filhos.',
    hint: (node) => {
      const parts = node.children.map((child) => (child.value ? child.value.s : '✖')).join(', ')
      return `${returnPart(node)}devolveu ${code(node.value.s)}, montado na volta a partir dos filhos (${code(parts)}).`
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
