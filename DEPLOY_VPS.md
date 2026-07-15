# Playspintech — VPS Kurulum Rehberi (Ubuntu 22.04+, port 80)

Bu rehber, projeyi kendi sunucunuzda root olarak kurmak içindir. Domain yok, port 80'de doğrudan IP üzerinden çalışır.

> ⚠️ Parolanızı sohbette paylaştığınız için mutlaka değiştirin: `passwd`

---

## 1. Sunucuya SSH ile bağlanın (kendi bilgisayarınızdan)

```bash
ssh root@178.83.226.194
```

## 2. Bağımlılıkları kurun

```bash
apt update && apt upgrade -y
apt install -y curl git nginx build-essential python3 python3-pip python3-venv
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g yarn pm2
# MongoDB 7
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu $(lsb_release -sc)/mongodb-org/7.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list
apt update && apt install -y mongodb-org
systemctl enable --now mongod
```

## 3. Projeyi indirin (Emergent'ten "Save to GitHub" ile bir repo oluşturun, sonra clone)

```bash
cd /opt
git clone https://github.com/<KULLANICI>/<REPO>.git playspintech
cd playspintech
```

Ya da Emergent'in sunduğu "Download code" ile indirip `scp` ile yükleyin.

## 4. Backend kurulumu

```bash
cd /opt/playspintech/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# .env oluştur
cat > .env <<'EOF'
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=playspintech
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRE_HOURS=24
CORS_ORIGINS=*
EOF
```

## 5. Frontend build

```bash
cd /opt/playspintech/frontend

# .env
cat > .env <<'EOF'
REACT_APP_BACKEND_URL=http://178.83.226.194
EOF

yarn install --frozen-lockfile
yarn build
```

## 6. Backend'i PM2 ile çalıştır

```bash
cd /opt/playspintech/backend
pm2 start "venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001" --name playspintech-backend
pm2 startup && pm2 save
```

## 7. Nginx (port 80'de reverse proxy)

```bash
cat > /etc/nginx/sites-available/playspintech <<'EOF'
server {
    listen 80 default_server;
    server_name _;

    root /opt/playspintech/frontend/build;
    index index.html;

    # API → backend
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # SPA fallback
    location / {
        try_files $uri /index.html;
    }

    client_max_body_size 20M;
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/playspintech /etc/nginx/sites-enabled/playspintech
nginx -t && systemctl reload nginx
```

## 8. Güvenlik duvarı

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw --force enable
```

## 9. Admin kullanıcı seed

Backend ilk açılışta admin kullanıcıyı otomatik oluşturur. Log'a bakın:

```bash
pm2 logs playspintech-backend --lines 100 | grep -i admin
```

Kimlik bilgileri `/app/memory/test_credentials.md`'de belirtildiği gibi:
- Email: `harryginny700@gmail.com`
- Password: `Admin123!`

## 10. Doğrulama

Tarayıcıdan `http://178.83.226.194` adresine gidin, login sayfası açılmalı.

---

## Bakım

- Log: `pm2 logs playspintech-backend`
- Restart: `pm2 restart playspintech-backend`
- Nginx: `systemctl status nginx`
- MongoDB: `systemctl status mongod`

## Güncelleme

```bash
cd /opt/playspintech
git pull
cd frontend && yarn install && yarn build
cd ../backend && source venv/bin/activate && pip install -r requirements.txt
pm2 restart playspintech-backend
systemctl reload nginx
```
