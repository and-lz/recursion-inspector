const vm = require('vm')
const util = require('util')

const EVENT_LIMIT = 20000
const TIME_LIMIT_MS = 5000
const PROBE_LIMIT = 40000
const STDOUT_LIMIT = 50
const MAX_ITEMS = 8
const MAX_DEPTH = 3
const MAX_TEXT = 200

function isNodeLike(value) {
  return 'val' in value && ('left' in value || 'right' in value || 'next' in value)
}

function formatPrimitive(value) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'function') return 'ƒ'
  if (typeof value === 'bigint') return `${value}n`
  return String(value)
}

function formatObject(value, nextFull, depth, seen) {
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => format(item, nextFull, depth + 1, seen))
    return `[${items.join(', ')}${value.length > MAX_ITEMS ? ', …' : ''}]`
  }
  const tag = Object.prototype.toString.call(value)
  if (tag === '[object Set]') return `Set(${format([...value], nextFull, depth + 1, seen)})`
  if (tag === '[object Map]') return `Map(${format([...value], nextFull, depth + 1, seen)})`
  const keys = Object.keys(value)
  const entries = keys
    .slice(0, MAX_ITEMS)
    .map((key) => `${key}: ${format(value[key], nextFull, depth + 1, seen)}`)
  return `{${entries.join(', ')}${keys.length > MAX_ITEMS ? ', …' : ''}}`
}

function format(value, full, depth = 0, seen = new Set()) {
  if (typeof value !== 'object' || value === null) return formatPrimitive(value)
  if (seen.has(value)) return '↺'
  if (isNodeLike(value) && (depth > 0 || !full)) {
    return `Nó(${format(value.val, false, depth + 1, seen)})`
  }
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[…]' : '{…}'

  seen.add(value)
  try {
    return formatObject(value, full && depth < MAX_DEPTH, depth, seen)
  } finally {
    seen.delete(value)
  }
}

function snapshot(value) {
  const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
  return { s: shorten(format(value, false), 40), f: shorten(format(value, true), MAX_TEXT) }
}

function callerLine(stack) {
  const lines = stack.split('\n').filter((line) => /user-code\.js:\d+:\d+/.test(line))
  if (lines.length < 2) return null
  return Number(lines[1].match(/user-code\.js:(\d+):\d+/)[1])
}

// `where()` devolve a chamada em andamento (ou null quando não dá para registrar).
// As funções devolvem o valor recebido: o programa do usuário não pode mudar de comportamento.
function createProbeHooks(probes, where) {
  function add(probe) {
    const position = probes.length < PROBE_LIMIT && where()
    if (position) probes.push({ ...probe(), ...position })
  }

  // `after` existe para i++, onde o valor novo só aparece depois da expressão.
  function __var(name, line, value, ...after) {
    add(() => ({ kind: 'var', name, line, v: snapshot(after.length ? after[0] : value) }))
    return value
  }

  // Os operandos são avaliados antes do teste fechar: ficam pendentes por chamada e o
  // `__cond` leva todos. Chamadas aninhadas no próprio teste têm fila separada.
  const pending = new Map()

  function __operand(src, line, value) {
    const position = where()
    if (!position) return value
    const queue = pending.get(position.id) || []
    queue.push({ src, v: snapshot(value) })
    pending.set(position.id, queue)
    return value
  }

  function __cond(src, line, value) {
    const position = where()
    const operands = (position && pending.get(position.id)) || []
    if (position) pending.delete(position.id)
    add(() => ({ kind: 'cond', src, line, result: Boolean(value), operands }))
    return value
  }

  return { __var, __cond, __operand }
}

function run(code) {
  const events = []
  const probes = []
  const stack = []
  const stdout = []
  let nextId = 0
  let truncated = false

  Error.stackTraceLimit = 6

  function __call(meta, args, self, original) {
    if (events.length >= EVENT_LIMIT) {
      truncated = true
      return original.apply(self, args)
    }

    const id = nextId++
    const parent = stack.length ? stack[stack.length - 1] : -1
    events.push({
      t: 'c',
      fn: meta.name,
      id,
      parent,
      depth: stack.length,
      args: args.map(snapshot),
      line: callerLine(new Error().stack),
    })
    stack.push(id)
    try {
      const result = original.apply(self, args)
      events.push({ t: 'r', id, v: snapshot(result) })
      return result
    } catch (error) {
      events.push({ t: 't', id, msg: String(error && error.message ? error.message : error) })
      throw error
    } finally {
      stack.pop()
    }
  }

  const { __var, __cond, __operand } = createProbeHooks(probes, () =>
    truncated || stack.length === 0 ? null : { id: stack[stack.length - 1], at: events.length },
  )

  const log = (...parts) => {
    if (stdout.length < STDOUT_LIMIT) stdout.push(util.format(...parts))
  }
  const sandbox = {
    __call,
    __var,
    __cond,
    __operand,
    structuredClone,
    console: { log, info: log, warn: log, error: log, debug: log },
  }

  let error = null
  try {
    vm.runInNewContext(code, sandbox, { filename: 'user-code.js', timeout: TIME_LIMIT_MS })
  } catch (caught) {
    error = String(caught && caught.message ? caught.message : caught)
  }

  return { events, probes, stdout, truncated, error }
}

process.on('message', (message) => {
  const result = run(message.code)
  process.send(result, () => process.exit(0))
})
