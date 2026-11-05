#!/usr/bin/env bash
set -euo pipefail
SOURCE=$(cd "$(dirname "$0")/.." && pwd)
APP=${1:-/www/wwwroot/app.nankaitechschool.com}
[[ -f "$APP/src/index.js" && -d "$APP/public/admin" ]] || { echo "服务目录不正确：$APP"; exit 1; }
FILES=(public/admin/index.html src/index.js src/routes/admin.js src/live-course.js src/live-table-sync.js src/live-replay.js src/replay-process.js src/replay-media.js src/replay-quark.js src/membership.js src/resource-links.js)
for file in "${FILES[@]}"; do
  test -s "$SOURCE/$file"
  if [[ "$file" == *.js ]]; then node --check "$SOURCE/$file"; fi
done
node -e 'if(Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || { echo '需要 Node.js 20 或更新版本'; exit 1; }
BACKUP=$(mktemp -d "$APP/backup-live-replay-XXXXXXXX")
for file in "${FILES[@]}"; do
  mkdir -p "$BACKUP/$(dirname "$file")"
  if [[ -f "$APP/$file" ]]; then cp -p "$APP/$file" "$BACKUP/$file"; fi
done
for file in "${FILES[@]}"; do cp "$SOURCE/$file" "$APP/$file"; done
echo "代码已替换，备份位于：$BACKUP"
echo '数据库、上传目录和 .env 未修改；首次安装不会自动启用批量回放任务。'
if command -v pm2 >/dev/null && pm2 describe robot-api >/dev/null 2>&1; then
  pm2 restart robot-api --update-env
elif command -v systemctl >/dev/null && systemctl is-active --quiet robot-api; then
  systemctl restart robot-api
else
  echo '请在宝塔手动重启对应 Node 服务。'
fi
echo '请刷新后台笔记管理，点击“检查回放接入”；授权完成后先用一节课试运行。'
