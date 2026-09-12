# n8n 自托管验证环境

用 n8n 做通用 UC 六步工作流底座，验证「审计 = 引擎真实执行账本的只读投影」。

- 模板：`../../instances/uc-template/n8n.workflow.json`（目标 → 感知 → 决策 → 执行(人审) → 验收 Gate → 学习）
- 通知：`BuildNotify` → `NotifyApprise`（Apprise 网关，飞书/钉钉/企微等多通道，失败不阻断 UC）
- 审计投影：`../../scripts/n8n-audit.mjs` → `orgos.uc.receipt.v1`
- 定位：n8n 是轮子，Apprise 是轮子，我们只写「节点编排 + 审计投影胶水」，不手写业务引擎。

## 部署

```bash
cd infra/n8n
cp .env.example .env          # 填入真实 DEEPSEEK_API_KEY；可选填 APPRISE_STATELESS_URLS
docker compose up -d
python3 bootstrap.py          # 首次创建 owner + public API key，写入 .api-key
```

通知渠道（可选）：把 `APPRISE_STATELESS_URLS` 填成逗号分隔的 Apprise URL，重启 `apprise` 侧车即生效；不填则通知节点安全跳过，不影响 UC 执行。

## 导入并激活通用 UC 模板

```bash
export N8N_API_KEY=$(cat .api-key)
# 导入（UC 是数据）
curl -s -X POST http://localhost:5678/api/v1/workflows \
  -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json;w=json.load(open("../../instances/uc-template/n8n.workflow.json"));print(json.dumps({"name":w["name"],"nodes":w["nodes"],"connections":w["connections"],"settings":w.get("settings",{})},ensure_ascii=False))')"
# 取返回的 id，激活
curl -s -X POST http://localhost:5678/api/v1/workflows/<workflowId>/activate \
  -H "X-N8N-API-KEY: $N8N_API_KEY"
```

## 跑一遍（真实执行 + 人审 + 审批通知）

```bash
# 1) 触发（webhook 是公开入口，携带调用通道/人/信号）
curl -s -X POST http://localhost:5678/webhook/uc-template/run \
  -H "Content-Type: application/json" \
  -d '{"channel":"feishu","actor":"cao-tianhang","signal":"乐饮江苏工厂 3 号线出品率 82.1%，低于 85% 阈值"}'

# 2) 查最新 execution id 与等待中节点的 resumeUrl
curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "http://localhost:5678/api/v1/executions?limit=1" | python3 -m json.tool

# 3) 审批通知：BuildNotify 已把 resumeUrl 通过 Apprise 发出（配置了 APPRISE_STATELESS_URLS 时）
#    审批人按通知里的地址人审拍板：POST 审批决定到 resumeUrl（Wait 节点不会自动完成）
curl -s -X POST "<resumeUrl>" -H "Content-Type: application/json" \
  -d '{"status":"approved","actor_role":"厂务负责人","rationale":"同意先复核再决定是否停机"}'
```

## 审计投影（真实账本，不做旁路重建）

```bash
N8N_URL=http://localhost:5678 N8N_API_KEY=$(cat .api-key) \
  node ../../scripts/n8n-audit.mjs --execution-id <id>
```

产出 `orgos.uc.receipt.v1`：调用凭据（channel/actor）、数据溯源（signal/learning）、Gate 映射（AcceptGate 节点真实 `gate`）、决策记忆（decision/learning）、节点事件轨迹。

## 已验证（2026-09-12，coolai）

| 场景 | 结果 |
|---|---|
| 正常 UC 六步 + 人审 approved | execution `success`，Gate pass=true，回执完整 |
| 人审提交非法 status | execution `error`，Gate pass=false，fail-closed 生效 |

人审节点用 `httpMethod: POST`（默认 GET 会丢审批 body）；Code 节点读取 `DEEPSEEK_MODEL` 需要 `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`（已写入 compose）。
