const { fork } = require('child_process')
const path = require('path')

const HARD_TIMEOUT_MS = 10000

function runTrace(code) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'child.js'))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Tempo esgotado ao executar o arquivo.'))
    }, HARD_TIMEOUT_MS)

    child.once('message', (result) => {
      clearTimeout(timer)
      resolve(result)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (exitCode) => {
      clearTimeout(timer)
      if (exitCode) reject(new Error(`Processo filho terminou com código ${exitCode}.`))
    })
    child.send({ code })
  })
}

module.exports = { runTrace }
