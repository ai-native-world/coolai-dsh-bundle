# Agent Loop 合同 v0.1（确定性约束机制）

## 一条总原则

> 凡是「非确定产出」（LLM、外部 Agent、外部系统/人回填的数据），必须被一个
> 「确定性约束机制」包住，才允许进入执行路径。约束机制是：封闭动作空间、
> Schema 校验、政策表、最小权限白名单、硬预算、fail-closed 降级。

这条原则不只用在 Loop 上，感知、决策、连接器回填、人审输入都适用。**缺了笼子的
非确定产出 = 架构违规。**

## Loop 是什么

六步环里，验收 Gate 失败不代表「这条 UC 死了」，而是把「为什么没过」作为一个
结构化的失败原因返回给外层 Agent，由 Agent 在**受限权力**内发起下一轮。

```
run1: 目标 → 感知 → 决策 → 执行(人审) → 验收Gate fail(reason)
        ↓ 回执(reason + 证据)
Agent: 按政策表选一个动作
        ↓ 三道闸：schema → 政策授权 → 预算
run2: 带着「上一轮缺的东西/换过的策略」重跑
        ↓ 或：escalate 给人 / stop 终止
```

每一轮都是一条独立、可审计的 run；Agent 不能改 Gate 门槛、不能编数据、不能替人
拍板。它只有四个动词。

## 四个动词（封闭动作空间）

| 动作 | 含义 | 必带字段 |
|---|---|---|
| `enrich_context` | 补数据，喂进下一轮感知 | `targets`（数据源，必须在白名单内） |
| `replan` | 给下一轮决策换指令/策略 | `instruction` |
| `escalate` | 承认修不了，升级给人 | `detail` |
| `stop` | 主动终止（只允许因超轮） | — |

除这四个之外，Agent 输出任何东西都会被拒。

## 失败原因 → 允许动作（政策表，确定性）

| Gate 失败原因 | 允许的动作 |
|---|---|
| `missing_field`（漏了事实） | `enrich_context` / `escalate` |
| `action_not_executable`（方案不可执行） | `replan` / `escalate` |
| `constraint_conflict`（目标/约束冲突） | `escalate` |
| `data_unavailable`（数据拿不到） | `escalate` |
| `permission_denied`（越权） | `escalate` |
| `max_rounds_exceeded`（超轮） | `stop` |
| `unknown`（其他一切） | `escalate` |

Agent 不能自由组合，只能在这个表里选。

## 三道闸（落地前强制）

1. **Schema 校验**：动作必须是四动词之一，字段类型/必填/上限达标。不合规 → 降级为
   `escalate/unknown`。
2. **政策授权**：`reason→action` 必须在政策表内；`enrich_context.targets` 必须全在
   白名单里。越权 → 降级为 `escalate/permission_denied`。
3. **硬预算**：`max_rounds`（默认 3）到顶 → 直接 `stop`，不再升级也不再跑。

任何一道不过，都**不会静默放行**，而是返回一个 fail-closed 决策，并写进审计账。

## 最小权限（谁也不能越界）

- Agent（规划）≠ 工作流（执行）≠ Gate（裁判）≠ 人（拍板）。
- `enrich_context` 只能读白名单数据源；`escalate` 只能发给 `human://owner`；
  `stop` 只能因超轮。
- 模板的 `allowed_sources` 默认为空 = **fail-closed 基线**：通用底座不放行任何
  数据源，实例必须显式声明（用友/金蝶/MES 这些属于实例，不在底座里）。

## 资产与实现

- 资产：`instances/uc-template/loop.policy.json`（政策表 + 权限 + 预算，客户可扩
  白名单，不可改动作空间/政策表）
- 机制：`packages/dsh-uc-workflow/lib/loop-policy.js`（把资产变成可执行判定）
- 测试：`tests/loop-policy.test.js`（13 条，覆盖越权/非法/超轮/白名单，全 fail-closed）

## 尚未接通的（下一步）

- 把 Gate 的失败输出改造成「结构化 reason」，而不是只抛 error（当前 n8n 模板的
  AcceptGate 只抛 `GATE_FAIL`，还没有 reason 字段）。
- 把 `enforceAction` 接到「Agent 读回执 → 触发下一轮 run」的真实编排里（现在机制
  已就位，编排层是下一步）。
