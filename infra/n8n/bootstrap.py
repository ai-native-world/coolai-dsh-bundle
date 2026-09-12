#!/usr/bin/env python3
"""n8n 自托管验证环境一键引导（owner + public API key）。

用法（在 coolai 上，先写好 .env）：
    cd infra/n8n
    docker compose up -d
    python3 bootstrap.py

幂等：已有 owner 则走 login；已有同名 api-key 则复用（读 .api-key）。
"""
import json, os, sys, time, urllib.request, urllib.error

N8N_URL = os.environ.get("N8N_URL", "http://localhost:5678").rstrip("/")
EMAIL = os.environ.get("N8N_OWNER_EMAIL", "admin@coolai.local")
PASSWORD = os.environ.get("N8N_OWNER_PASSWORD", "CoolaiN8nDev2026!")
LABEL = os.environ.get("N8N_API_KEY_LABEL", "coolai-cli")

def req(method, path, body=None, cookie=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    r = urllib.request.Request(N8N_URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

# 1. healthz
for _ in range(60):
    try:
        with urllib.request.urlopen(N8N_URL + "/healthz", timeout=2) as r:
            if r.status == 200:
                break
    except Exception:
        pass
    time.sleep(1)
else:
    print("n8n 未就绪", file=sys.stderr)
    sys.exit(1)

# 2. owner setup 或 login
cookie = None
status, headers, body = req("POST", "/rest/owner/setup", {"email": EMAIL, "firstName": "Cool", "lastName": "AI", "password": PASSWORD})
if status == 200:
    cookie = headers.get("Set-Cookie", "").split(";")[0]
else:
    status, headers, body = req("POST", "/rest/login", {"emailOrLdapLoginId": EMAIL, "password": PASSWORD})
    if status != 200:
        print("owner setup/login 失败:", status, body.decode()[:300], file=sys.stderr)
        sys.exit(2)
    cookie = headers.get("Set-Cookie", "").split(";")[0]

# 3. 已有同名 key 则复用文件
keyfile = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".api-key")
if os.path.exists(keyfile):
    old = open(keyfile).read().strip()
    if old:
        print("复用已有 .api-key（长度 %d）" % len(old))
        sys.exit(0)

# 4. 取合法 scopes 并创建 key
status, _, body = req("GET", "/rest/api-keys/scopes", cookie=cookie)
scopes = json.loads(body)["data"] if status == 200 else []
status, _, body = req("POST", "/rest/api-keys", {"label": LABEL, "scopes": scopes, "expiresAt": 1900000000000}, cookie=cookie)
if status != 200:
    print("创建 api-key 失败:", status, body.decode()[:300], file=sys.stderr)
    sys.exit(3)
raw = json.loads(body)["data"]["rawApiKey"]
open(keyfile, "w").write(raw)
print("api-key 已写入 %s（长度 %d）" % (keyfile, len(raw)))
