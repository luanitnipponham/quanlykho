#!/bin/sh
# Chuẩn bị cơ sở dữ liệu rồi mới chạy API.
#   1. Chờ PostgreSQL nhận kết nối
#   2. Áp migration (prisma migrate deploy — chạy lại nhiều lần vẫn an toàn)
#   3. Nạp dữ liệu mẫu nếu CSDL còn trống và SEED_ON_START != false
set -e

echo "[entrypoint] Chờ PostgreSQL..."
i=0
until node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$queryRaw\`SELECT 1\`.then(() => p.\$disconnect()).then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[entrypoint] LỖI: không kết nối được PostgreSQL sau 120 giây. Kiểm tra DATABASE_URL."
    exit 1
  fi
  sleep 2
done
echo "[entrypoint] PostgreSQL đã sẵn sàng."

echo "[entrypoint] Áp migration..."
npx --no-install prisma migrate deploy

if [ "${SEED_ON_START:-true}" != "false" ]; then
  # Chỉ nạp khi chưa có tài khoản nào — không ghi đè dữ liệu thật.
  EMPTY=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.count().then((n) => { console.log(n === 0 ? 'yes' : 'no'); return p.\$disconnect(); }).catch(() => { console.log('no'); process.exit(0); });
")
  if [ "$EMPTY" = "yes" ]; then
    echo "[entrypoint] CSDL trống — nạp dữ liệu mẫu..."
    node dist/seed.js
  else
    echo "[entrypoint] CSDL đã có dữ liệu — bỏ qua bước nạp mẫu."
  fi
fi

echo "[entrypoint] Khởi động API..."
exec "$@"
