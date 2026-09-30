# TRIỂN KHAI BẰNG DOCKER TRÊN LINUX (v3.4)

> Tổng quan hệ thống: [doc.md](doc.md) · An ninh: [security.md](security.md)
> Cập nhật: 2026-09-29

---

## 1. Kiến trúc khi chạy Docker

```
                    ┌──────────────────────────────────────────┐
   Trình duyệt ───▶ │  web (nginx)            cổng 80          │
                    │   • phục vụ giao diện đã build (tĩnh)    │
                    │   • /api/*  ──proxy──▶  api:3000         │
                    └───────────────┬──────────────────────────┘
                                    │ mạng nội bộ của compose
                    ┌───────────────▼──────────────────────────┐
                    │  api (NestJS + Prisma)   cổng 3000       │
                    │   • volume: storage  → /app/storage      │
                    └───────────────┬──────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────────┐
                    │  db (PostgreSQL 18)      cổng 5432       │
                    │   • volume: db-data                      │
                    └──────────────────────────────────────────┘
```

**Chỉ container `web` mở cổng ra ngoài.** `api` và `db` nằm trong mạng nội bộ, không truy cập trực tiếp từ bên ngoài được.

Hai volume giữ dữ liệu sống qua các lần dựng lại container:

| Volume | Chứa gì | Mất volume này nghĩa là |
| :-- | :-- | :-- |
| `db-data` | Toàn bộ cơ sở dữ liệu | Mất mọi phiếu, người dùng, lịch sử |
| `storage` | Cây `CHUNG_TU/` — tệp đính kèm | Mất mọi file đã upload |

---

## 2. Yêu cầu máy chủ

- Linux 64-bit (Ubuntu 22.04 / Debian 12 trở lên là đủ).
- Docker Engine 24+ và Docker Compose v2 (`docker compose`, không phải `docker-compose` cũ).
- Tối thiểu 2 GB RAM, 10 GB đĩa trống. Lần build đầu cần mạng để tải image và gói npm.

Kiểm tra:
```bash
docker --version && docker compose version
```

### Cài Docker nếu máy chủ chưa có

Ubuntu / Debian — dùng kho chính thức của Docker, không dùng gói `docker.io` của distro
vì bản đó thường thiếu plugin `compose` v2:

```bash
sudo apt update && sudo apt install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg   | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable"   | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

> Trên Debian, thay `ubuntu` bằng `debian` ở hai URL trên.

Cho phép chạy `docker` không cần `sudo` (đăng xuất rồi đăng nhập lại để có hiệu lực):

```bash
sudo usermod -aG docker $USER
newgrp docker
```

---

## 3. Triển khai lần đầu

### Cách nhanh: một lệnh

[`deploy.sh`](../deploy.sh) làm trọn bộ — kiểm tra máy chủ và tạo swap nếu thiếu RAM, cài
Docker nếu chưa có, đồng bộ mã nguồn, sinh `POSTGRES_PASSWORD` và `JWT_SECRET` ngẫu nhiên
(đảm bảo khớp giữa `DATABASE_URL` và `POSTGRES_PASSWORD`), mở tường lửa, dựng container,
chờ tới khi giao diện trả 200 và API trả 401, rồi dọn bộ nhớ đệm:

```bash
curl -fsSL https://raw.githubusercontent.com/luanitnipponham/quanlykho/main/deploy.sh -o deploy.sh
less deploy.sh           # nên đọc trước khi chạy bằng quyền root
sudo bash deploy.sh
```

Cùng script đó dùng cho mọi lần cập nhật về sau:

```bash
cd /opt/quanlykho
git fetch origin main && git reset --hard origin/main
./deploy.sh
```

Script tự gọi `sudo` nếu cần, nên không phải gõ `sudo ./deploy.sh`.

| Biến | Tác dụng |
| :-- | :-- |
| `PREBUILT=true` | Kéo image dựng sẵn trên GHCR thay vì build tại chỗ — khoảng 30 giây, không cần RAM để biên dịch |
| `HTTP_PORT=8080` | Đổi cổng phía ngoài cho lần chạy này |
| `SEED_DEMO=true` | Nạp thêm danh mục và phiếu mẫu |
| `NO_GIT=true` | Không đồng bộ mã nguồn, chỉ dựng lại |
| `NO_PRUNE=true` | Không dọn bộ nhớ đệm |

#### Đổi cổng cố định

Nếu máy chủ còn chạy web khác chiếm cổng 80, đặt cổng một lần trong file `.env` ở gốc dự án —
đây chính là file `docker compose` tự đọc, nên mọi lệnh về sau đều dùng đúng cổng đó:

```bash
cd /opt/quanlykho
echo 'HTTP_PORT=8080' > .env
./deploy.sh
```

Địa chỉ khi đó là `http://<IP máy chủ>:8080`. Nhớ sửa `CORS_ORIGIN` trong `deploy/app.env`
cho khớp. `.env` nằm trong `.gitignore` nên `git reset --hard` không xoá mất.

Chạy lại nhiều lần vẫn an toàn: script **không** ghi đè `deploy/app.env` đã có, vì đổi mật
khẩu trong đó sẽ khiến API không mở được database cũ. Bước đồng bộ dùng `git reset --hard`
nên mọi sửa đổi tại chỗ trong file đã theo dõi sẽ mất — nhưng `deploy/app.env` và các volume
dữ liệu không bị đụng tới vì chúng không nằm trong Git.

### Cách thủ công, từng bước

```bash
# 1. Tải mã nguồn về máy chủ
sudo mkdir -p /opt && cd /opt
sudo git clone https://github.com/luanitnipponham/quanlykho.git
sudo chown -R $USER:$USER /opt/quanlykho
cd /opt/quanlykho

# 2. Tạo file cấu hình từ mẫu
cp deploy/app.env.example deploy/app.env

# 3. Sinh mật khẩu và khóa JWT thật
openssl rand -base64 24   # dùng cho POSTGRES_PASSWORD
openssl rand -base64 48   # dùng cho JWT_SECRET

# 4. Sửa deploy/app.env
nano deploy/app.env

# 5. Dựng và chạy
docker compose up -d --build

# 6. Theo dõi tới khi thấy "Khởi động API..."
docker compose logs -f api
```

Mở `http://<địa-chỉ-máy-chủ>/`.

### Mở tường lửa

Chỉ cổng 80 (và 443 nếu đã bật HTTPS ở mục 6) cần mở. PostgreSQL và API **không**
được mở ra ngoài — chúng chỉ nói chuyện trong mạng nội bộ của compose.

```bash
# Ubuntu / Debian
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw enable && sudo ufw status

# RHEL / Rocky / AlmaLinux
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload
```

### Tự bật lại sau khi máy chủ khởi động lại

Mọi service trong `docker-compose.yml` đều đặt `restart: unless-stopped`, nên chỉ cần
Docker tự chạy lúc boot là đủ:

```bash
sudo systemctl enable docker
```

### Bắt buộc sửa trong `deploy/app.env`

| Biến | Ghi chú |
| :-- | :-- |
| `POSTGRES_PASSWORD` | Đặt mật khẩu mạnh |
| `DATABASE_URL` | Phải chứa đúng mật khẩu vừa đặt; giữ nguyên host `db` |
| `JWT_SECRET` | **Bắt buộc đổi.** Để nguyên giá trị mẫu là lỗ hổng nghiêm trọng |
| `SEED_PASSWORD` | Mật khẩu của 5 tài khoản mẫu tạo lần đầu |

Lần chạy đầu, container `api` tự động: chờ PostgreSQL → áp migration → nạp 4 phòng ban, 5 tài khoản, ngày lễ và cấu hình **nếu cơ sở dữ liệu còn trống**. Những lần sau nó thấy đã có dữ liệu và bỏ qua bước nạp, nên không bao giờ ghi đè dữ liệu thật.

Danh mục (dự án, hạng mục chi, nhà cung cấp, người yêu cầu) và phiếu mẫu **không** được nạp:
hệ thống bắt đầu trống để nhập dữ liệu thật. Nếu muốn có dữ liệu demo để xem thử:

```bash
docker compose exec -e SEED_DEMO=true api node dist/seed.js
```

Sau khi đăng nhập lần đầu, hệ thống bắt đổi mật khẩu. Nên đổi hết 5 tài khoản mẫu rồi xóa những tài khoản không dùng.

---

## 4. Vận hành hằng ngày

| Việc | Lệnh |
| :-- | :-- |
| Xem trạng thái | `docker compose ps` |
| Xem log | `docker compose logs -f api` (hoặc `web`, `db`) |
| Khởi động lại | `docker compose restart api` |
| Tắt (giữ dữ liệu) | `docker compose down` |
| Bật lại | `docker compose up -d` |
| Cập nhật mã nguồn mới | `git fetch origin main && git reset --hard origin/main && ./deploy.sh` |
| Vào psql | `docker compose exec db psql -U quanlykho -d quanlykho` |

> `docker compose down -v` **xóa cả volume** — mất toàn bộ dữ liệu và file đính kèm. Chỉ dùng khi thật sự muốn làm lại từ đầu.

---

### Chạy bằng image dựng sẵn (không build trên máy chủ)

[`.github/workflows/publish-images.yml`](../.github/workflows/publish-images.yml) dựng sẵn hai
image mỗi lần đẩy lên nhánh `main` và đẩy lên GitHub Container Registry. Máy chủ chỉ kéo về:

```bash
PREBUILT=true ./deploy.sh
```

Mất khoảng 30 giây thay vì 5–15 phút, và không cần RAM để biên dịch argon2 — hợp với máy chủ nhỏ.

Sau lần chạy workflow đầu tiên, vào trang **Packages** của repo, mở từng package rồi
**Package settings → Change visibility → Public**. Nếu để Private, máy chủ phải đăng nhập trước:

```bash
echo "<GitHub token co quyen read:packages>" | docker login ghcr.io -u luanitnipponham --password-stdin
```

---

## 5. Sao lưu và khôi phục

Sao lưu cả hai thứ — chỉ một trong hai là không đủ. Tệp đính kèm không có database
đi kèm thì không biết tệp nào thuộc phiếu nào.

### Cách nhanh: một lệnh

[`deploy/backup.sh`](../deploy/backup.sh) làm cả hai — `pg_dump` nén gzip và `rsync` cây
`CHUNG_TU` — vào cùng một nơi, mặc định `/mnt/nas`:

```bash
sudo bash deploy/backup.sh                      # chạy ngay một lần
sudo bash deploy/backup.sh --install-cron       # cài lịch 01:00 hằng ngày
```

Kết quả nằm ở `/mnt/nas/quanlykho/`:

```
quanlykho/
├── db/db-2026-09-30.sql.gz
└── CHUNG_TU/{CUNG_UNG,KE_TOAN}/<ngày>/<mã phiếu>/<tệp>
```

| Biến | Tác dụng |
| :-- | :-- |
| `BACKUP_DIR=/mnt/nas` | Nơi cất bản sao |
| `KEEP_DAYS=14` | Giữ bao nhiêu ngày bản dump database |
| `ALLOW_LOCAL=true` | Cho phép ghi vào thư mục không phải điểm gắn mạng |

Script **dừng lại nếu `BACKUP_DIR` không phải điểm gắn (mount point)**. Khi NAS chưa được
gắn, đường dẫn đó chỉ là thư mục rỗng trên đĩa cục bộ — bản sao sẽ âm thầm ghi vào chính
máy chủ và mất luôn tác dụng khi máy đó hỏng. Bản dump cũng chỉ được đổi sang tên chính
thức sau khi `gzip -t` xác nhận hợp lệ, nên mất điện giữa chừng không phá bản cũ.

`rsync` cố ý **không** dùng `--delete`: nếu ai đó lỡ xóa tệp trong ứng dụng, bản sao vẫn còn.

### Bật chức năng Lưu trữ / Phục hồi

Sau khi gắn NAS và chạy `backup.sh` ít nhất một lần (để có tệp mốc `.quanlykho-archive`):

```bash
cd /opt/quanlykho
echo 'ARCHIVE_HOST_DIR=/mnt/nas/quanlykho' >> .env
./deploy.sh
```

`deploy.sh` thấy biến đó thì tự thêm [`docker-compose.archive.yml`](../docker-compose.archive.yml)
vào lệnh compose, gắn thư mục NAS vào container API tại `/archive`.

#### Cách 2: để Docker nối thẳng tới NAS

Dùng khi chạy trên **Windows** (Docker Desktop không bind-mount được ổ mạng đã ánh xạ),
hoặc khi không muốn đụng tới `/etc/fstab`. Khai báo trong `.env` ở gốc dự án:

```
NAS_HOST=192.168.4.XX
NAS_SHARE=ten_share
NAS_USER=tai_khoan_nas
NAS_PASS=mat_khau_nas
```

`deploy.sh` thấy `NAS_HOST` thì thêm [`docker-compose.archive-cifs.yml`](../docker-compose.archive-cifs.yml),
tạo một Docker volume nối SMB/CIFS thẳng tới NAS. Không cần hệ điều hành gắn trước.

NAS đời cũ có thể cần `NAS_SMB_VERSION=2.1` hoặc `1.0`.

Tạo tệp mốc lần đầu (thay `docker compose` bằng đúng lệnh bạn đang dùng):

```bash
docker compose exec api touch /archive/.quanlykho-archive
```

> Cách 1 an toàn hơn khi có thể: mật khẩu NAS nằm trong `/etc/nas-credentials` với quyền
> `chmod 600`, không phải trong `.env` mà compose đọc. `.env` đã nằm trong `.gitignore`
> nên không lên GitHub, nhưng vẫn là một chỗ nữa chứa mật khẩu.

Từ đó Admin thấy thêm hai nút ở màn **Phiếu hoàn thành**: biểu tượng hộp lưu trữ để chuyển
tệp sang NAS và dọn đĩa máy chủ, biểu tượng mũi tên để kéo tệp về lại. Hồ sơ phiếu không
bị đụng tới nên vẫn tra cứu và báo cáo bình thường.

Phần gắn NAS cố ý tách thành file compose riêng: Docker tự tạo thư mục nguồn nếu nó chưa
tồn tại, nên gắn mặc định sẽ âm thầm dựng `/mnt/nas/quanlykho` ngay trên đĩa máy chủ khi
NAS chưa được gắn — đúng cái bẫy mà tính năng này phải tránh.

### Gắn NAS

```bash
sudo apt install -y cifs-utils
sudo mkdir -p /mnt/nas
sudo tee /etc/nas-credentials > /dev/null <<'EOF'
username=TEN_DANG_NHAP_NAS
password=MAT_KHAU_NAS
EOF
sudo chmod 600 /etc/nas-credentials
echo '//192.168.4.XX/ten_share /mnt/nas cifs credentials=/etc/nas-credentials,uid=1000,gid=1000,vers=3.0,nofail,_netdev 0 0' | sudo tee -a /etc/fstab
sudo mount -a
```

Mật khẩu để trong file riêng `chmod 600`, không để thẳng trong `/etc/fstab` vì file đó ai
cũng đọc được. `nofail` để máy chủ vẫn khởi động bình thường khi NAS tắt.

### Làm thủ công

```bash
# Sao lưu cơ sở dữ liệu
docker compose exec -T db pg_dump -U quanlykho quanlykho | gzip > backup-db-$(date +%F).sql.gz

# Sao lưu tệp đính kèm
docker run --rm -v quanlykho-main_storage:/data -v "$PWD":/backup alpine \
  tar czf /backup/backup-files-$(date +%F).tar.gz -C /data .
```

Khôi phục:
```bash
gunzip -c backup-db-2026-09-29.sql.gz | docker compose exec -T db psql -U quanlykho -d quanlykho

docker run --rm -v quanlykho-main_storage:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/backup-files-2026-09-29.tar.gz -C /data"
```

Tên volume phụ thuộc tên thư mục dự án. Xem chính xác bằng `docker volume ls`.

Nên đặt lịch cron chạy sao lưu hằng ngày và **thử khôi phục định kỳ** — bản sao lưu chưa từng khôi phục thử thì chưa chắc dùng được.

---

## 6. Đưa ra Internet: bắt buộc thêm HTTPS

Cấu hình hiện tại chạy HTTP, phù hợp mạng nội bộ. Nếu mở ra Internet, **bắt buộc** đặt một reverse proxy có TLS phía trước (Caddy, Traefik hoặc nginx + certbot).

Ví dụ với Caddy — sửa `docker-compose.yml` cho `web` không mở cổng 80 ra ngoài nữa, rồi:

```caddyfile
phieuchi.congty.vn {
    reverse_proxy web:80
}
```

Sau khi có HTTPS, nhớ đặt `CORS_ORIGIN=https://phieuchi.congty.vn` trong `deploy/app.env`.

Giới hạn tần suất (`@nestjs/throttler`: 300 lượt/phút mỗi IP, riêng `/auth/login` 10 lượt/phút)
và security header (`helmet`) đã bật sẵn trong API. Chỉnh bằng `RATE_LIMIT_PER_MINUTE` và
`RATE_LIMIT_LOGIN_PER_MINUTE` trong `deploy/app.env` nếu cần.
Việc còn lại trước khi chạy thật nằm ở [security.md §8](security.md): thu hồi quyền xóa trên bảng nhật ký.

---

## 7. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
| :-- | :-- | :-- |
| Trang báo **"Không kết nối được máy chủ"** | Container `api` chưa chạy hoặc lỗi kết nối CSDL | `docker compose ps` rồi `docker compose logs api` |
| `api` khởi động lại liên tục | `DATABASE_URL` sai mật khẩu hoặc sai tên database | So lại với `POSTGRES_*` trong `deploy/app.env`, rồi `docker compose up -d --force-recreate` |
| Đăng nhập báo sai mật khẩu ở lần đầu | `SEED_PASSWORD` đã đổi sau khi CSDL được nạp | Đặt lại mật khẩu bằng tài khoản `admin`, hoặc làm lại từ đầu bằng `docker compose down -v` |
| Upload file báo lỗi dung lượng | File vượt 25 MB | Giới hạn theo thiết kế; Admin đổi trong màn Cấu hình và sửa `client_max_body_size` ở `deploy/nginx.conf` |
| Tải lại trang thì mất file đính kèm | Chạy `down -v` làm mất volume `storage` | Khôi phục từ bản sao lưu ở mục 5 |
| Build lỗi ở bước `npm ci` | Máy chủ không ra được Internet | Mở mạng cho máy chủ, hoặc build image ở nơi khác rồi `docker save` / `docker load` |

Xem giao diện đang nói chuyện với đâu: badge góc phải màn hình hiện **PostgreSQL** (xanh) là đang ghi thật vào cơ sở dữ liệu.

---

## 8. Khác biệt so với chạy trên Windows

| | Windows (`start.bat`) | Docker trên Linux |
| :-- | :-- | :-- |
| Giao diện | Vite dev server, cổng 5173 | nginx phục vụ bản build tĩnh, cổng 80 |
| Gọi API | Proxy của Vite | Proxy của nginx |
| Backend | `ts-node src/main.ts` | `node dist/main.js` (đã biên dịch) |
| Cơ sở dữ liệu | PostgreSQL cài trên máy | Container `db` + volume `db-data` |
| Tệp đính kèm | `apps/api/storage/` | Volume `storage` |
| Migration | `npm run db:push` | `prisma migrate deploy` tự chạy lúc khởi động |
| Mất backend | **Báo lỗi và dừng** (đặt `VITE_REQUIRE_BACKEND=true` trong `.env` gốc) | **Báo lỗi và dừng** — tránh nhập liệu vào chỗ không được lưu |
