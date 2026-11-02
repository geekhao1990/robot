#!/usr/bin/env bash
set -euo pipefail
APP=${1:-/www/wwwroot/app.nankaitechschool.com}
SOURCE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FILES=(
  src/live-course.js src/new-user-gold.js src/live-table-sync.js
  src/gold-finger-source.js src/gold-finger-sync.js src/content-types.js
  src/note-access.js src/resource-links.js src/util.js src/web-wechat-login.js
  src/routes/admin.js src/routes/public.js src/routes/app.js src/index.js
  public/admin/index.html
)
test -d "$APP/src" || { echo "服务目录不存在：$APP/src"; exit 1; }
for FILE in "${FILES[@]}"; do
  test -f "$SOURCE/$FILE"
  if [[ "$FILE" == *.js ]]; then node --check "$SOURCE/$FILE"; fi
done
BACKUP=$(mktemp -d "$APP/backup-live-XXXXXXXX")
for FILE in "${FILES[@]}"; do
  mkdir -p "$BACKUP/$(dirname "$FILE")"
  if [ -f "$APP/$FILE" ]; then cp "$APP/$FILE" "$BACKUP/$FILE"; fi
  install -o www -g www -m 644 "$SOURCE/$FILE" "$APP/$FILE"
done
echo "服务端文件已更新，备份：$BACKUP"
echo "请重启 robot-api，并在后台点击同步直播课程。小程序须另行上传发布。"
