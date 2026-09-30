#!/usr/bin/env bash
#
# Sao luu HE THONG PHIEU YEU CAU CHI: database + tep dinh kem, bang MOT lenh.
#
#   sudo bash deploy/backup.sh
#   sudo bash deploy/backup.sh --install-cron     # cai lich chay hang ngay 01:00
#
# Sao luu CA HAI thu, vi thieu mot trong hai la khong khoi phuc duoc:
#   - Database  -> pg_dump nen gzip, giu theo ngay
#   - Tep dinh kem -> rsync giu nguyen cay CHUNG_TU/{CUNG_UNG,KE_TOAN}/ngay/ma_phieu
#
# Bien moi truong tuy chon:
#   BACKUP_DIR=/mnt/nas   noi cat ban sao (mac dinh /mnt/nas)
#   KEEP_DAYS=14          giu bao nhieu ngay ban dump database (mac dinh 14)
#   ALLOW_LOCAL=true      cho phep ghi vao thu muc KHONG phai diem gan mang
#
# KHOI PHUC:
#   gunzip -c /mnt/nas/quanlykho/db/db-2026-09-30.sql.gz \
#     | docker compose -f docker-compose.prod.yml exec -T db psql -U quanlykho -d quanlykho
#   rsync -a /mnt/nas/quanlykho/CHUNG_TU/ /var/lib/docker/volumes/quanlykho_storage/_data/CHUNG_TU/

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/mnt/nas}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DEST="$BACKUP_DIR/quanlykho"
STAMP=$(date +%F)

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BOLD=$'\033[1m'
OFF=$'\033[0m'

step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$OFF"; }
ok()   { printf '    %s[ok]%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '    %s[!]%s  %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '\n%sLOI:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "Can quyen root. Dang nhap bang root roi chay lai."
  exec sudo -E bash "$0" "$@"
fi

SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$SELF_DIR/.." && pwd)
cd "$REPO_DIR"

# ---------------------------------------------------------------------------
# Cai lich chay hang ngay roi thoat.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--install-cron" ]; then
  LINE="0 1 * * * BACKUP_DIR=$BACKUP_DIR KEEP_DAYS=$KEEP_DAYS $REPO_DIR/deploy/backup.sh >> /var/log/quanlykho-backup.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'deploy/backup.sh' || true; echo "$LINE" ) | crontab -
  ok "Da cai lich sao luu 01:00 hang ngay"
  ok "Nhat ky: /var/log/quanlykho-backup.log"
  crontab -l | grep backup.sh
  exit 0
fi

# ---------------------------------------------------------------------------
step "1/4  Kiem tra noi cat ban sao"
# ---------------------------------------------------------------------------
[ -d "$BACKUP_DIR" ] || die "Khong thay $BACKUP_DIR. Gan NAS truoc, hoac dat BACKUP_DIR=<duong dan khac>."

# Neu NAS chua gan, $BACKUP_DIR chi la thu muc rong tren dia cuc bo: ban sao se
# am tham ghi vao chinh may chu va vo dung khi may do hong. Phai chan tu dau.
if ! mountpoint -q "$BACKUP_DIR" && [ "${ALLOW_LOCAL:-}" != "true" ]; then
  echo
  warn "Kiem tra bang:  mount | grep $BACKUP_DIR"
  warn "Gan NAS:        sudo mount -a"
  warn "Neu that su muon ghi vao dia cuc bo:  ALLOW_LOCAL=true $0"
  die "$BACKUP_DIR khong phai diem gan (mount point) — NAS co the chua duoc gan."
fi

mkdir -p "$DEST/db" "$DEST/CHUNG_TU"
# Tep moc: API doi thay no moi cho phep Luu tru / Phuc hoi (A5). Neu NAS rot,
# diem gan thanh thu muc rong khong co tep nay, va thao tac bi tu choi.
touch "$DEST/.quanlykho-archive"
touch "$DEST/.ghi_thu" 2>/dev/null || die "Khong ghi duoc vao $DEST. Kiem tra quyen hoac tuy chon uid khi mount."
rm -f "$DEST/.ghi_thu"
ok "Ghi duoc vao $DEST"

# ---------------------------------------------------------------------------
step "2/4  Tim he thong dang chay"
# ---------------------------------------------------------------------------
if docker compose -f docker-compose.prod.yml ps --status running --services 2>/dev/null | grep -qx db; then
  COMPOSE=(docker compose -f docker-compose.prod.yml)
elif docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  COMPOSE=(docker compose)
else
  die "Khong thay container 'db' dang chay trong $REPO_DIR."
fi
ok "Dung ${COMPOSE[*]}"

PGUSER=$(grep -E '^POSTGRES_USER=' deploy/app.env | cut -d= -f2- || true)
PGDB=$(grep -E '^POSTGRES_DB=' deploy/app.env | cut -d= -f2- || true)
[ -n "$PGUSER" ] || PGUSER=quanlykho
[ -n "$PGDB" ] || PGDB=quanlykho

# ---------------------------------------------------------------------------
step "3/4  Sao luu database"
# ---------------------------------------------------------------------------
TMP="$DEST/db/.db-$STAMP.sql.gz.dang_ghi"
FINAL="$DEST/db/db-$STAMP.sql.gz"

# pipefail o dau file dam bao pg_dump hong thi ca duong ong bao hong,
# khong de lai mot file .gz rong trong nhu sao luu thanh cong.
"${COMPOSE[@]}" exec -T db pg_dump -U "$PGUSER" "$PGDB" | gzip > "$TMP"

gzip -t "$TMP" 2>/dev/null || { rm -f "$TMP"; die "Ban dump hong (gzip -t that bai)."; }
SIZE=$(stat -c %s "$TMP")
[ "$SIZE" -gt 1000 ] || { rm -f "$TMP"; die "Ban dump chi $SIZE byte — gan nhu chac chan la loi."; }

# Chi doi ten khi da chac chan hop le: neu dang ghi ma mat dien, ban cu van con.
mv -f "$TMP" "$FINAL"
ok "Database: $(du -h "$FINAL" | cut -f1)  ->  $FINAL"

if [ "$KEEP_DAYS" -gt 0 ]; then
  # Chi dung toi file dung mau ten cua chinh script nay.
  DELETED=$(find "$DEST/db" -maxdepth 1 -name 'db-*.sql.gz' -mtime "+$KEEP_DAYS" -print -delete | wc -l)
  [ "$DELETED" -eq 0 ] || ok "Da xoa $DELETED ban dump cu hon $KEEP_DAYS ngay"
fi

# ---------------------------------------------------------------------------
step "4/4  Sao luu tep dinh kem"
# ---------------------------------------------------------------------------
API_ID=$("${COMPOSE[@]}" ps -q api)
[ -n "$API_ID" ] || die "Khong thay container 'api' dang chay."

# Hoi thang Docker cho dat volume, thay vi doan ten theo thu muc du an.
SRC=$(docker inspect "$API_ID" --format '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Source}}{{end}}{{end}}')
[ -n "$SRC" ] || die "Khong xac dinh duoc volume gan tai /app/storage."
ok "Nguon: $SRC/CHUNG_TU"

if [ -d "$SRC/CHUNG_TU" ]; then
  command -v rsync >/dev/null 2>&1 || {
    (apt-get update -qq && apt-get install -y -qq rsync) || die "Khong cai duoc rsync."
  }
  # Co y KHONG dung --delete: neu ai do lo xoa tep trong ung dung, ban sao van con.
  rsync -a "$SRC/CHUNG_TU/" "$DEST/CHUNG_TU/"
  FILES=$(find "$DEST/CHUNG_TU" -type f | wc -l)
  ok "Tep dinh kem: $FILES tep  ->  $DEST/CHUNG_TU"
else
  warn "Chua co thu muc CHUNG_TU — he thong chua co tep dinh kem nao"
fi

TOTAL=$(du -sh "$DEST" 2>/dev/null | cut -f1)
printf '\n%s%sSAO LUU XONG.%s  Tong dung luong tai %s: %s\n\n' "$GREEN" "$BOLD" "$OFF" "$DEST" "$TOTAL"
printf '  Khoi phuc database:\n'
printf '    gunzip -c %s | %s exec -T db psql -U %s -d %s\n\n' "$FINAL" "${COMPOSE[*]}" "$PGUSER" "$PGDB"
printf '  Khoi phuc tep dinh kem:\n'
printf '    rsync -a %s/CHUNG_TU/ %s/CHUNG_TU/\n\n' "$DEST" "$SRC"
