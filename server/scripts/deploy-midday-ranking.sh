#!/usr/bin/env bash
set -euo pipefail
APP=${1:-/www/wwwroot/app.nankaitechschool.com}
SOURCE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FILES=(src/dark-fund-midday-ranking.js src/index.js src/routes/admin.js public/admin/index.html public/admin/ladder.js public/admin/ranking-poster.js)
test -d "$APP/src"
for FILE in "${FILES[@]}"; do
  test -f "$SOURCE/$FILE"
  if [[ "$FILE" == *.js ]]; then node --check "$SOURCE/$FILE"; fi
done
BACKUP=$(mktemp -d "$APP/backup-midday-XXXXXXXX")
for FILE in "${FILES[@]}"; do
  mkdir -p "$BACKUP/$(dirname "$FILE")"
  if [ -f "$APP/$FILE" ]; then cp "$APP/$FILE" "$BACKUP/$FILE"; fi
  install -o www -g www -m 644 "$SOURCE/$FILE" "$APP/$FILE"
done
echo "午间榜已更新，备份在 $BACKUP，请重启 robot-api。"
