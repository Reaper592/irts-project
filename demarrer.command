#!/bin/bash
# ---------------------------------------------------------------------------
#  IRTS Suite — démarrage sur macOS et Linux
#
#  Double-cliquez ce fichier. Il installe ce qu'il faut la première fois,
#  construit l'application si nécessaire, démarre le serveur partagé et ouvre
#  le navigateur. Les fois suivantes, il démarre directement.
#
#  Pour arrêter : fermez cette fenêtre, ou Ctrl+C.
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-8080}"

echo ""
echo "  IRTS Suite — Marée Sonore · MSR · Owlaris"
echo "  ----------------------------------------"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js n'est pas installé sur cet ordinateur."
  echo ""
  echo "  Installez-le depuis https://nodejs.org (version 20 ou plus récente),"
  echo "  puis double-cliquez à nouveau ce fichier."
  echo ""
  read -r -p "  Appuyez sur Entrée pour fermer. " _
  exit 1
fi

VERSION="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$VERSION" -lt 20 ]; then
  echo "  Node.js $(node --version) est trop ancien : il faut la version 20 ou plus."
  echo "  Mettez-le à jour depuis https://nodejs.org, puis relancez."
  echo ""
  read -r -p "  Appuyez sur Entrée pour fermer. " _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "  Première installation, cela prend une minute…"
  npm install --no-audit --no-fund || { echo "  L'installation a échoué."; read -r -p "  Entrée pour fermer. " _; exit 1; }
  echo ""
fi

if [ ! -f dist/index.html ]; then
  echo "  Construction de l'application…"
  npm run build || { echo "  La construction a échoué."; read -r -p "  Entrée pour fermer. " _; exit 1; }
  echo ""
fi

# Le navigateur s'ouvre une fois le serveur en écoute.
(
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://localhost:${PORT}/api/sante"; then
      if command -v open >/dev/null 2>&1; then open "http://localhost:${PORT}"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:${PORT}"
      fi
      exit 0
    fi
    sleep 0.5
  done
) &

PORT="$PORT" node server/index.js
