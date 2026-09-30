#!/usr/bin/env bash
#
# Cap nhat HE THONG PHIEU YEU CAU CHI len phien ban moi nhat tren GitHub.
#
#   cd /opt/quanlykho && sudo bash deploy/update.sh
#
# Script nay: keo code moi (git pull) -> build va kich hoat ban moi
# (docker compose up -d --build) -> cho khoe manh -> don bo nho dem cu.
#
# Du lieu KHONG bi dung toi: volume db-data va storage giu nguyen qua moi lan cap nhat.
# deploy/app.env cung giu nguyen.
#
# Bien moi truong tuy chon:
#   HTTP_PORT=8080   cong phia ngoai, phai giong luc cai dat (mac dinh 80)
#   NO_PRUNE=true    bo qua buoc don bo nho dem

set -euo pipefail

HTTP_PORT="${HTTP_PORT:-80}"

GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
BOLD=$'\033[1m'
OFF=$'\033[0m'

step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$OFF"; }
ok()   { printf '    %s[ok]%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '    %s[!]%s  %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '\n%sLOI:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

# Chay duoc tu bat ky dau: tu tim goc du an theo vi tri cua chinh script.
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$SELF_DIR/.." && pwd)
cd "$REPO_DIR"

[ -f docker-compose.yml ] || die "Khong thay docker-compose.yml trong $REPO_DIR"
[ -f deploy/app.env ] || die "Chua co deploy/app.env. Chay deploy/install.sh truoc."

docker info >/dev/null 2>&1 || die "Khong noi duoc toi Docker. Thu lai voi sudo, hoac: systemctl status docker"

# ---------------------------------------------------------------------------
step "1/4  Keo code moi"
# ---------------------------------------------------------------------------
BEFORE=$(git rev-parse --short HEAD)

# Canh bao neu co sua doi tai cho, vi git pull se tu choi hoac de lai xung dot.
if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "Co thay doi chua commit trong thu muc lam viec:"
  git status --short | head -10
  die "Hoan tac bang 'git checkout -- .' hoac commit lai, roi chay lai script."
fi

# --ff-only: chi tua nhanh. Neu lich su re nhanh thi dung lai de nguoi dung xu ly,
# khong tu dong merge tren may chu.
git pull --ff-only
AFTER=$(git rev-parse --short HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  ok "Da la ban moi nhat ($AFTER) — van build lai de chac chan"
else
  ok "Cap nhat $BEFORE -> $AFTER"
  git --no-pager log --oneline "$BEFORE..$AFTER" | head -10 | sed 's/^/      /'
fi

# ---------------------------------------------------------------------------
step "2/4  Build va kich hoat ban moi"
# ---------------------------------------------------------------------------
export HTTP_PORT
# Migration moi (neu co) tu chay trong entrypoint truoc khi API khoi dong.
docker compose up -d --build

# ---------------------------------------------------------------------------
step "3/4  Cho he thong san sang"
# ---------------------------------------------------------------------------
READY=0
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${HTTP_PORT}/" 2>/dev/null || echo 000)
  API=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${HTTP_PORT}/api/v1/departments" 2>/dev/null || echo 000)
  # 401 la dung: API song va dang doi token.
  if [ "$CODE" = "200" ] && [ "$API" = "401" ]; then READY=1; break; fi
  sleep 5
done

if [ "$READY" -eq 1 ]; then
  ok "Giao dien tra 200, API tra 401 (dung — dang doi token)"
else
  docker compose ps || true
  echo
  docker compose logs api --tail 40 || true
  echo
  warn "Quay ve ban truoc bang:  git reset --hard $BEFORE && docker compose up -d --build"
  die "He thong chua san sang sau 5 phut. Xem log phia tren."
fi

# ---------------------------------------------------------------------------
step "4/4  Don bo nho dem"
# ---------------------------------------------------------------------------
if [ "${NO_PRUNE:-}" = "true" ]; then
  ok "Bo qua theo yeu cau (NO_PRUNE=true)"
else
  BEFORE_DISK=$(df -BM --output=avail / | tail -1 | tr -dc '0-9')

  # Chi xoa image mo coi (dangling) — la cac lop cu bi thay the o lan build nay.
  # Co y KHONG dung 'docker system prune -a' vi no xoa ca image cua du an khac
  # tren cung may chu, va KHONG bao gio dung '--volumes' vi do la du lieu that.
  docker image prune -f >/dev/null 2>&1 || true

  # Bo nho dem build cu hon 3 ngay. Giu lai phan moi de lan build sau con nhanh.
  docker builder prune -f --filter until=72h >/dev/null 2>&1 || true

  AFTER_DISK=$(df -BM --output=avail / | tail -1 | tr -dc '0-9')
  FREED=$((AFTER_DISK - BEFORE_DISK))
  if [ "$FREED" -gt 0 ]; then
    ok "Da giai phong ${FREED} MB"
  else
    ok "Khong co gi de don"
  fi
fi

IP_SHOW=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$IP_SHOW" ] || IP_SHOW="localhost"
if [ "$HTTP_PORT" = "80" ]; then URL="http://$IP_SHOW"; else URL="http://$IP_SHOW:$HTTP_PORT"; fi

printf '\n%s%sDA CAP NHAT XONG.%s  %s\n\n' "$GREEN" "$BOLD" "$OFF" "$URL"
docker compose ps
echo
