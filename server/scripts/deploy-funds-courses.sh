#!/usr/bin/env bash
set -euo pipefail
REV=${1:?请指定已推送的完整提交号}
APP=${2:-/www/wwwroot/app.nankaitechschool.com}
[[ "$REV" =~ ^[0-9a-f]{40}$ ]] || { echo "提交号格式错误"; exit 1; }
test -d "$APP/src" || { echo "服务目录错误：$APP"; exit 1; }
APP=$(cd "$APP" && pwd)
FILES=(
  public/admin/index.html
  src/live-course.js src/live-table-sync.js src/membership.js
  src/payment-orders.js src/resource-links.js src/util.js
  src/routes/admin.js src/routes/dark-fund-payment.js
  src/routes/payment.js src/routes/public.js
)
STAGE=$(mktemp -d)
BASE="https://raw.githubusercontent.com/geekhao1990/robot/$REV/server"
# 所有文件下载及语法检查成功后，才替换线上代码。
for FILE in "${FILES[@]}"; do
  mkdir -p "$STAGE/$(dirname "$FILE")"
  curl -fL --retry 3 --connect-timeout 15 --max-time 90 "$BASE/$FILE" -o "$STAGE/$FILE"
  if [[ "$FILE" == *.js ]]; then node --check "$STAGE/$FILE"; fi
done
BACKUP=$(mktemp -d "$APP/backup-funds-courses-XXXXXXXX")
for FILE in "${FILES[@]}"; do
  mkdir -p "$BACKUP/$(dirname "$FILE")"
  if [ -f "$APP/$FILE" ]; then cp -p "$APP/$FILE" "$BACKUP/$FILE"; fi
done
for FILE in "${FILES[@]}"; do
  cp "$STAGE/$FILE" "$APP/$FILE"
done
echo "已替换代码，未修改数据库、配置或上传文件。备份：$BACKUP"
if command -v pm2 >/dev/null 2>&1 && pm2 describe robot-api >/dev/null 2>&1; then
  pm2 restart robot-api
elif command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet robot-api; then
  systemctl restart robot-api
else
  echo "未找到运行中的 robot-api，请在宝塔中手动重启对应 Node 服务。"
fi
echo "后台页面请强制刷新；小程序代码需要另行上传并发布。"
