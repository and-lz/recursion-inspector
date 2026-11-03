#!/bin/sh
# Commit automático com mensagem derivada das mudanças.
git add -A
git diff --cached --quiet && exit 0

total=$(git diff --cached --name-only | wc -l | tr -d ' ')
names=$(git diff --cached --name-only | head -3 | xargs -n1 basename | paste -sd, - | sed 's/,/, /g')
if [ "$total" -gt 3 ]; then
  names="$names e mais $((total - 3))"
fi

if git diff --cached --name-only | grep -qv '^test/'; then
  verb="Atualiza"
else
  verb="Ajusta testes:"
fi

git commit -q -m "$verb $names" -m "$(git diff --cached --stat)"
