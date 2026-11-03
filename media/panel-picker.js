// Com mais de uma chamada o input muda: quem escolhe a execução é o usuário.
function showRootPicker(labels) {
  elements.app.hidden = true
  const heading = document.createElement('h2')
  heading.textContent = `${labels.length} chamadas a ${state.data.fnName}: qual inspecionar?`
  const buttons = labels.map((label, index) => {
    const button = document.createElement('button')
    button.textContent = shorten(label, 80)
    button.addEventListener('click', () => {
      elements.rootPicker.hidden = true
      elements.app.hidden = false
      elements.rootSelect.value = index
      startRoot(index)
    })
    return button
  })
  elements.rootPicker.replaceChildren(heading, ...buttons)
  elements.rootPicker.hidden = false
}
