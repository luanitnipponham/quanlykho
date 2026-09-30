#!/usr/bin/env bash
#
# Cài đặt trọn gói HỆ THỐNG PHIẾU YÊU CẦU CHI trên Linux — chạy một lệnh là xong.
#
#   curl -fsSL https://raw.githubusercontent.com/luanitnipponham/quanlykho/main/deploy/install.sh -o install.sh
#   sudo bash install.sh
#
# Script này: cài Docker nếu chưa có → tải mã nguồn → sinh mật khẩu và JWT_SECRET
# ngẫu nhiên → dựng 3 container → chờ khỏe mạnh → kiểm tra rồi in tài khoản đăng nhập.
#
# Chạy lại nhiều lần vẫn an toàn: KHÔNG bao giờ ghi đè deploy/app.env đã có, vì đổi
# mật khẩu trong đó sẽ khiến API không mở được database cũ.
#
# Biến môi trường tùy chọn:
#   HTTP_PORT=8080    cổng phía ngoài (mặc định 80)
#   REPO_DIR=/srv/x   nơi đặt mã nguồn (mặc định /opt/quanlykho)
#   SEED_DEMO=true    nạp thêm danh mục và phiếu mẫu để xem thử

set -euo pipefail

REPO_URL="https://github.com/luanitnipponham/quanlykho.git"
REPO_DIR="${REPO_DIR:-/opt/quanlykho}"
HTTP_PORT="${HTTP_PORT:-80}"

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BOLD=$'\033[1m'
OFF=$'\033[0m'

step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$OFF"; }
ok()   { printf '    %s[ok]%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '    %s[!]%s  %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '\n%sLOI:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Can quyen root. Chay lai bang:  sudo bash $0"

# ---------------------------------------------------------------------------
step "1/7  Kiem tra may chu"
# ---------------------------------------------------------------------------
if [ -r /etc/os-release ]; then
  . /etc/os-release
  ok "${PRETTY_NAME:-Linux} ($(uname -m))"
else
  warn "Khong doc duoc /etc/os-release"
fi

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$((MEM_MB + SWAP_MB))" -lt 1900 ]; then
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

DISK_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
[ "${DISK_GB:-0}" -ge 8 ] || die "Chi con ${DISK_GB} GB trong tren /. Can toi thieu 8 GB."
ok "Dia trong: ${DISK_GB} GB"

# ---------------------------------------------------------------------------
step "2/7  Cai Docker"
# ---------------------------------------------------------------------------
install_pkg() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y "$@"
  elif command -v yum >/dev/null 2>&1; then
    yum install -y "$@"
  else
    return 1
  fi
}

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

# Nguoi goi sudo duoc them vao nhom docker, co hieu luc tu lan dang nhap sau.
REAL_USER="${SUDO_USER:-}"
if [ -n "$REAL_USER" ] && [ "$REAL_USER" != "root" ]; then
  if ! id -nG "$REAL_USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    usermod -aG docker "$REAL_USER" 2>/dev/null \
      && warn "Da them '$REAL_USER' vao nhom docker — dang xuat roi vao lai de dung docker khong can sudo."
  fi
fi

# ---------------------------------------------------------------------------
step "3/7  Tai ma nguon"
# ---------------------------------------------------------------------------
SELF_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
fi

if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/../docker-compose.yml" ]; then
  # Script dang nam trong ban sao da clone — dung luon cho do.
  REPO_DIR=$(cd "$SELF_DIR/.." && pwd)
  ok "Dung ma nguon san co tai $REPO_DIR"
elif [ -f "$REPO_DIR/docker-compose.yml" ]; then
  ok "Da co ma nguon tai $REPO_DIR"
else
  command -v git >/dev/null 2>&1 || install_pkg git || die "Khong cai duoc git."
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
  if [ -n "$REAL_USER" ]; then chown -R "$REAL_USER:$REAL_USER" "$REPO_DIR" || true; fi
  ok "Da tai ve $REPO_DIR"
fi
cd "$REPO_DIR"

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
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PW|" deploy/app.env
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://quanlykho:$PW@db:5432/quanlykho?schema=public|" deploy/app.env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" deploy/app.env
  sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=$ORIGIN|" deploy/app.env
  chmod 600 deploy/app.env
  ok "Da sinh deploy/app.env voi mat khau va JWT_SECRET ngau nhien"
fi

SEED_PW=$(grep -E '^SEED_PASSWORD=' deploy/app.env | cut -d= -f2- || true)
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
else
  warn "Khong thay ufw/firewalld — bo qua buoc tuong lua"
fi
warn "May ao dam may: nho mo cong ${HTTP_PORT} trong Security Group tren bang dieu khien."

# ---------------------------------------------------------------------------
step "6/7  Dung va chay (lan dau mat 5-15 phut)"
# ---------------------------------------------------------------------------
export HTTP_PORT
docker compose up -d --build

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

echo
if [ "$READY" -eq 1 ]; then
  ok "Giao dien tra 200, API tra 401 (dung — dang doi token)"
  if [ "${SEED_DEMO:-}" = "true" ]; then
    if docker compose exec -T -e SEED_DEMO=true api node dist/seed.js >/dev/null 2>&1; then
      ok "Da nap danh muc va phieu mau"
    else
      warn "Khong nap duoc du lieu mau"
    fi
  fi
else
  docker compose ps || true
  echo
  docker compose logs api --tail 40 || true
  die "He thong chua san sang sau 5 phut. Xem log phia tren; thuong do DATABASE_URL khong khop POSTGRES_PASSWORD."
fi

IP_SHOW=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$IP_SHOW" ] || IP_SHOW="localhost"
if [ "$HTTP_PORT" = "80" ]; then URL="http://$IP_SHOW"; else URL="http://$IP_SHOW:$HTTP_PORT"; fi

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
printf '    docker compose ps                              xem trang thai\n'
printf '    docker compose logs -f api                     xem log\n'
printf '    docker compose down                            tat, giu du lieu\n'
printf '    docker compose up -d                           bat lai\n'
printf '    git pull && docker compose up -d --build       cap nhat phien ban moi\n\n'
