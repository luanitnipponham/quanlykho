#!/usr/bin/env bash
#
# HE THONG PHIEU YEU CAU CHI — trien khai va cap nhat bang MOT lenh.
#
#   git fetch origin main && git reset --hard origin/main
#   ./deploy.sh
#
# Dung duoc ca cho lan dau tren may chu trang lan cho moi lan cap nhat ve sau.
# Script tu lam: cai Docker neu chua co -> dong bo ma nguon -> sinh mat khau va
# JWT_SECRET neu chua co -> build va kich hoat -> cho khoe manh -> don bo nho dem.
#
# Lan dau tren may chu trang, neu chua co ma nguon:
#   curl -fsSL https://raw.githubusercontent.com/luanitnipponham/quanlykho/main/deploy.sh -o deploy.sh
#   sudo bash deploy.sh
#
# Bien moi truong tuy chon:
#   PREBUILT=true    keo image dung san tren GHCR thay vi build tai cho (nhanh hon nhieu)
#   IMAGE_TAG=sha-x  quay ve mot ban cu (chi co tac dung khi PREBUILT=true)
#   HTTP_PORT=8080   cong phia ngoai (mac dinh 80; hoac dat co dinh trong file .env)
#   REPO_DIR=/srv/x  noi dat ma nguon (mac dinh /opt/quanlykho)
#   NO_GIT=true      bo qua buoc dong bo ma nguon
#   NO_PRUNE=true    bo qua buoc don bo nho dem
#   SEED_DEMO=true   nap them danh muc va phieu mau de xem thu
#   RESET_DATA=XOA   xoa sach phieu, danh muc va tep dinh kem truoc khi chay

set -euo pipefail

REPO_URL="https://github.com/luanitnipponham/quanlykho.git"
# Gia tri nguoi dung truyen vao dong lenh; neu khong co thi lat sau se doc tu .env
# cua du an (chinh file ma docker compose doc), roi moi lay mac dinh 80.
HTTP_PORT_ARG="${HTTP_PORT:-}"

# Xoa du lieu la viec khong hoan tac duoc. Bat go dung chu XOA chu khong phai
# "true": mot lan go nham tren may chu that la mat sach phieu. Kiem tra ngay tu
# dau de khong phai cho het ca quy trinh moi bao sai.
RESET_DATA="${RESET_DATA:-}"
if [ -n "$RESET_DATA" ] && [ "$RESET_DATA" != "XOA" ]; then
  echo "LOI: RESET_DATA chi nhan gia tri XOA. Vi du: RESET_DATA=XOA ./deploy.sh" >&2
  exit 1
fi

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BOLD=$'\033[1m'
OFF=$'\033[0m'

step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$OFF"; }
ok()   { printf '    %s[ok]%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '    %s[!]%s  %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '\n%sLOI:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

# `set -e` giet script ma khong in gi, rat kho doan khi chay tren may chu.
# Bay nay in ro dong lenh nao hong truoc khi thoat.
on_err() {
  echo "" >&2
  echo "${RED}LOI:${OFF} script dung o dong ${1:-?} (ma thoat ${2:-?}). Lenh: ${3:-?}" >&2
}
trap 'on_err "$LINENO" "$?" "$BASH_COMMAND"' ERR

# Doc mot bien trong file .env. grep khong khop se tra ve 1; duoi `set -e`
# cong `pipefail` dieu do du de giet ca script ma khong in loi nao, nen boc
# lai bang `|| true`: thieu dong trong .env chi cho ra chuoi rong.
env_val() { grep -E "^$1=" "${2:-.env}" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

# Docker can quyen root. Tu nang quyen de nguoi dung chi phai go "./deploy.sh".
# -E giu lai cac bien tuy chon o tren.
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "Can quyen root nhung khong co sudo. Dang nhap bang root roi chay lai."
  printf '%s==> Can quyen root, dang goi sudo...%s\n' "$BOLD" "$OFF"
  exec sudo -E bash "$0" "$@"
fi

install_pkg() {
  if   command -v apt-get >/dev/null 2>&1; then apt-get update -qq && apt-get install -y -qq "$@"
  elif command -v dnf     >/dev/null 2>&1; then dnf install -y "$@"
  elif command -v yum     >/dev/null 2>&1; then yum install -y "$@"
  else return 1; fi
}

# ---------------------------------------------------------------------------
step "1/7  Kiem tra may chu"
# ---------------------------------------------------------------------------
if [ -r /etc/os-release ]; then
  . /etc/os-release
  ok "${PRETTY_NAME:-Linux} ($(uname -m))"
fi

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$((MEM_MB + SWAP_MB))" -lt 1900 ] && [ "${PREBUILT:-}" != "true" ]; then
  warn "Chi co ${MEM_MB} MB RAM + ${SWAP_MB} MB swap; buoc build can khoang 2 GB."
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "Da bat swap 2 GB"
  else
    warn "/swapfile da ton tai, bo qua"
  fi
else
  ok "Bo nho: ${MEM_MB} MB RAM + ${SWAP_MB} MB swap"
fi

DISK_MB=$(df -BM --output=avail / | tail -1 | tr -dc '0-9')
# Build tai cho ton dia hon nhieu: npm ci, ma nguon trung gian va bo nho dem cua buildx.
# Keo image dung san thi chi can cho ba image cong du lieu.
if [ "${PREBUILT:-}" = "true" ]; then NEED_MB=3072; else NEED_MB=5120; fi
if [ "${DISK_MB:-0}" -lt "$NEED_MB" ]; then
  echo
  df -h / || true
  echo
  warn "Ubuntu cai mac dinh thuong chi cap mot phan o cho LVM. Kiem tra phan con trong:"
  warn "    sudo vgs                                            (xem cot VFree)"
  warn "    sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv"
  warn "    sudo resize2fs /dev/ubuntu-vg/ubuntu-lv"
  warn "Neu VFree = 0 thi o da cap het — phai don bot hoac noi rong o ao:"
  warn "    sudo apt clean && sudo apt autoremove --purge -y && sudo journalctl --vacuum-size=100M"
  warn "    docker system df          (xem Docker dang chiem bao nhieu)"
  die "Chi con ${DISK_MB} MB trong tren /. Che do nay can toi thieu $((NEED_MB / 1024)) GB."
fi
ok "Dia trong: ${DISK_MB} MB (can $((NEED_MB / 1024)) GB)"

# ---------------------------------------------------------------------------
step "2/7  Cai Docker"
# ---------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Da co $(docker --version | cut -d, -f1)"
else
  command -v curl >/dev/null 2>&1 || install_pkg curl ca-certificates \
    || die "Khong cai duoc curl. Cai thu cong roi chay lai."
  # Script chinh thuc cua Docker tu nhan dien distro va them kho dung cach.
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
  command -v docker >/dev/null 2>&1 || die "Cai Docker that bai."
  ok "Da cai $(docker --version | cut -d, -f1)"
fi

systemctl enable --now docker >/dev/null 2>&1 || true
docker info >/dev/null 2>&1 || die "Docker daemon khong chay. Kiem tra: systemctl status docker"
ok "Docker daemon dang chay"

REAL_USER="${SUDO_USER:-}"
if [ -n "$REAL_USER" ] && [ "$REAL_USER" != "root" ]; then
  if ! id -nG "$REAL_USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    usermod -aG docker "$REAL_USER" 2>/dev/null \
      && warn "Da them '$REAL_USER' vao nhom docker — co hieu luc tu lan dang nhap sau."
  fi
fi

# ---------------------------------------------------------------------------
step "3/7  Ma nguon"
# ---------------------------------------------------------------------------
SELF_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
fi

if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/docker-compose.yml" ]; then
  # Script dang nam trong ban sao da clone — dung luon cho do.
  REPO_DIR="$SELF_DIR"
else
  REPO_DIR="${REPO_DIR:-/opt/quanlykho}"
  if [ ! -f "$REPO_DIR/docker-compose.yml" ]; then
    command -v git >/dev/null 2>&1 || install_pkg git || die "Khong cai duoc git."
    mkdir -p "$(dirname "$REPO_DIR")"
    git clone "$REPO_URL" "$REPO_DIR"
    [ -n "$REAL_USER" ] && chown -R "$REAL_USER:$REAL_USER" "$REPO_DIR" || true
    ok "Da tai ve $REPO_DIR"
  fi
fi
cd "$REPO_DIR"

# docker compose tu doc file .env cua du an. Neu chi dat HTTP_PORT o do ma script
# lai mac dinh 80 thi buoc kiem tra cuoi se do nham cong va bao that bai oan.
if [ -f .env ]; then
  [ -n "$HTTP_PORT_ARG" ] || HTTP_PORT_ENV=$(env_val HTTP_PORT | tr -dc '0-9')
  ARCHIVE_HOST_DIR="${ARCHIVE_HOST_DIR:-$(env_val ARCHIVE_HOST_DIR)}"
  NAS_HOST="${NAS_HOST:-$(env_val NAS_HOST)}"
fi
HTTP_PORT="${HTTP_PORT_ARG:-${HTTP_PORT_ENV:-80}}"

if [ "${NO_GIT:-}" = "true" ] || [ ! -d .git ]; then
  ok "Bo qua dong bo ma nguon"
else
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
  [ "$BRANCH" != "HEAD" ] || BRANCH=main
  BEFORE=$(git rev-parse --short HEAD 2>/dev/null || echo '?')
  git fetch --prune origin "$BRANCH"
  # Khop chinh xac voi ban tren GitHub. Khong dung toi file chua theo doi nen
  # deploy/app.env va cac volume du lieu van nguyen ven.
  git reset --hard "origin/$BRANCH"
  AFTER=$(git rev-parse --short HEAD)
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "Da la ban moi nhat ($AFTER)"
  else
    ok "Cap nhat $BEFORE -> $AFTER"
    git --no-pager log --oneline "$BEFORE..$AFTER" 2>/dev/null | head -10 | sed 's/^/      /' || true
  fi
fi

if [ "${PREBUILT:-}" = "true" ]; then
  [ -f docker-compose.prod.yml ] || die "Khong thay docker-compose.prod.yml"
  COMPOSE=(docker compose -f docker-compose.prod.yml)
else
  COMPOSE=(docker compose -f docker-compose.yml)
fi

# Kho luu tru chi duoc gan khi da khai bao ro rang. Hai cach, uu tien cach da gan san
# o muc he dieu hanh vi no khong can mat khau NAS nam trong .env.
if [ -n "${ARCHIVE_HOST_DIR:-}" ]; then
  if [ -d "$ARCHIVE_HOST_DIR" ]; then
    export ARCHIVE_HOST_DIR
    COMPOSE+=(-f docker-compose.archive.yml)
    ok "Kho luu tru: thu muc da gan san $ARCHIVE_HOST_DIR"
  else
    warn "ARCHIVE_HOST_DIR=$ARCHIVE_HOST_DIR khong ton tai — bo qua phan gan NAS."
  fi
elif [ -n "${NAS_HOST:-}" ]; then
  # Docker tu noi toi NAS bang CIFS; khong can he dieu hanh gan truoc.
  COMPOSE+=(-f docker-compose.archive-cifs.yml)
  ok "Kho luu tru: noi thang toi NAS $NAS_HOST bang CIFS"
fi

# ---------------------------------------------------------------------------
step "4/7  Cau hinh"
# ---------------------------------------------------------------------------
if [ -f deploy/app.env ]; then
  # Ghi de se doi mat khau database, khien API khong mo duoc du lieu da co.
  ok "deploy/app.env da ton tai — giu nguyen"
else
  command -v openssl >/dev/null 2>&1 || install_pkg openssl || die "Khong cai duoc openssl."
  PW=$(openssl rand -base64 24 | tr -d '/+=')
  JWT=$(openssl rand -base64 48 | tr -d '\n')
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  [ -n "$IP" ] || IP="localhost"
  if [ "$HTTP_PORT" = "80" ]; then ORIGIN="http://$IP"; else ORIGIN="http://$IP:$HTTP_PORT"; fi

  cp deploy/app.env.example deploy/app.env
  # Sinh tu mot bien duy nhat nen mat khau luon khop giua hai dong —
  # day la loi hay gap nhat khi sua bang tay.
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PW|" deploy/app.env
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://quanlykho:$PW@db:5432/quanlykho?schema=public|" deploy/app.env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" deploy/app.env
  sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=$ORIGIN|" deploy/app.env
  chmod 600 deploy/app.env
  ok "Da sinh deploy/app.env voi mat khau va JWT_SECRET ngau nhien"
fi

SEED_PW=$(env_val SEED_PASSWORD deploy/app.env)
[ -n "$SEED_PW" ] || SEED_PW='Password@123'

# ---------------------------------------------------------------------------
step "5/7  Tuong lua"
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow "${HTTP_PORT}/tcp" >/dev/null 2>&1 || true
  if ufw status 2>/dev/null | head -1 | grep -q inactive; then
    # Co y khong tu bat: neu SSH chay cong khac thuong, bat ufw se khoa ban khoi may chu.
    warn "ufw dang tat. Da them luat san; tu bat khi chac chan:  sudo ufw enable"
  else
    ok "Da mo cong ${HTTP_PORT}/tcp tren ufw"
  fi
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="${HTTP_PORT}/tcp" >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  ok "Da mo cong ${HTTP_PORT}/tcp tren firewalld"
fi

# ---------------------------------------------------------------------------
if [ "${PREBUILT:-}" = "true" ]; then
  step "6/7  Keo image dung san va kich hoat"
else
  step "6/7  Build va kich hoat (lan dau mat 5-15 phut)"
fi
# ---------------------------------------------------------------------------
export HTTP_PORT
# Rong thi docker-compose.prod.yml tu lay "latest".
export IMAGE_TAG="${IMAGE_TAG:-}"
# Migration moi (neu co) tu chay trong entrypoint truoc khi API khoi dong.
if [ "${PREBUILT:-}" = "true" ]; then
  "${COMPOSE[@]}" pull
  "${COMPOSE[@]}" up -d
else
  "${COMPOSE[@]}" up -d --build
fi

# ---------------------------------------------------------------------------
step "7/7  Cho he thong san sang"
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
  if [ "$RESET_DATA" = "XOA" ]; then
    warn "Dang xoa du lieu nghiep vu theo yeu cau RESET_DATA=XOA"
    # Cung script ma may Windows dung: xoa phieu, lich su, dinh kem (ca tep tren
    # dia), danh muc va bo dem ma phieu. Giu lai tai khoan, phong ban, ngay le.
    if "${COMPOSE[@]}" exec -T api node dist/reset-data.js; then
      ok "Da xoa du lieu nghiep vu; tai khoan va phong ban van con"
    else
      die "Khong xoa duoc du lieu. Xem log phia tren."
    fi
  fi
  if [ "${SEED_DEMO:-}" = "true" ]; then
    if "${COMPOSE[@]}" exec -T -e SEED_DEMO=true api node dist/seed.js >/dev/null 2>&1; then
      ok "Da nap danh muc va phieu mau"
    else
      warn "Khong nap duoc du lieu mau"
    fi
  fi
else
  "${COMPOSE[@]}" ps || true
  echo
  "${COMPOSE[@]}" logs api --tail 40 || true
  echo
  warn "Thuong do DATABASE_URL khong khop POSTGRES_PASSWORD trong deploy/app.env."
  die "He thong chua san sang sau 5 phut. Xem log phia tren."
fi

# ---------------------------------------------------------------------------
step "Don bo nho dem"
# ---------------------------------------------------------------------------
if [ "${NO_PRUNE:-}" = "true" ]; then
  ok "Bo qua theo yeu cau"
else
  BEFORE_DISK=$(df -BM --output=avail / | tail -1 | tr -dc '0-9')
  # Chi xoa image mo coi (dangling) — cac lop cu vua bi thay the.
  # Co y KHONG dung 'docker system prune -a': lenh do xoa ca image cua du an khac
  # tren cung may chu. Va khong bao gio dung '--volumes' vi do la du lieu that.
  docker image prune -f >/dev/null 2>&1 || true
  # Bo nho dem build cu hon 3 ngay; giu phan moi de lan build sau con nhanh.
  docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
  AFTER_DISK=$(df -BM --output=avail / | tail -1 | tr -dc '0-9')
  FREED=$((AFTER_DISK - BEFORE_DISK))
  if [ "$FREED" -gt 0 ]; then ok "Da giai phong ${FREED} MB"; else ok "Khong co gi de don"; fi
fi

IP_SHOW=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$IP_SHOW" ] || IP_SHOW="localhost"
if [ "$HTTP_PORT" = "80" ]; then URL="http://$IP_SHOW"; else URL="http://$IP_SHOW:$HTTP_PORT"; fi
CC="${COMPOSE[*]}"

printf '\n%s%sHOAN TAT.%s\n\n' "$GREEN" "$BOLD" "$OFF"
printf '  Dia chi      %s%s%s\n' "$BOLD" "$URL" "$OFF"
printf '  Ma nguon     %s\n' "$REPO_DIR"
printf '  Cau hinh     %s/deploy/app.env  (chua mat khau — chmod 600, khong commit)\n\n' "$REPO_DIR"
printf '  Tai khoan (mat khau chung: %s%s%s)\n' "$BOLD" "$SEED_PW" "$OFF"
printf '    cungung    Phong Cung Ung          tao phieu B1\n'
printf '    lanhdao    Lanh Dao                duyet B2\n'
printf '    taichinh   Truong phong Tai chinh  B3\n'
printf '    ketoan     Phong Ke toan           B4-B8\n'
printf '    admin      Quan tri he thong       toan quyen\n\n'
printf '  %sDoi mat khau ca 5 tai khoan ngay sau khi dang nhap lan dau.%s\n\n' "$YELLOW" "$OFF"
printf '  He thong khoi dong voi danh muc trong. Dang nhap cungung, vao form tao phieu,\n'
printf '  bam "Quan ly" o tung o chon de nhap du an, hang muc chi, nha cung cap that.\n\n'
printf '  Lenh thuong dung (chay trong %s):\n' "$REPO_DIR"
printf '    %s ps            xem trang thai\n' "$CC"
printf '    %s logs -f api   xem log\n' "$CC"
printf '    %s down          tat, giu du lieu\n' "$CC"
printf '    ./deploy.sh              cap nhat len ban moi nhat\n\n'
"${COMPOSE[@]}" ps
echo
