# 乐饮 UC-RD-001｜熟豆拼配候选到试验闭环

本文是 Runtime 执行合同，不是报告写作要求。把本文与一个 UC 实例交给没有前置上下文的 Agent，Agent 必须产出可被程序校验、可生成打样任务、可消费试验结果的结构化 Run Bundle。

人看的配方建议单只能由 Run Bundle 渲染，不能作为业务真源。

## 1. 这个 UC 真正完成什么

本 UC 从已确认的客户需求或标样分析开始，到以下闭环结束：

```text
理解目标
→ 形成有证据的候选
→ 生成可执行打样计划
→ 接收试验结果
→ 比较预测与实测
→ 形成通过、修订或淘汰结论
→ 生成可复用学习记录
→ 等待配方责任人决定
```

它不是“一次生成一份建议书”。没有试验结果、预测偏差和学习记录时，只能称为“打样计划就绪”，不能称为端到端完成。

### 1.1 范围

- 起点：`requirement_driven` 或 `benchmark_driven` 二选一；
- 当前切口：昆山研发点的熟豆拼配小样；
- 终点：当前批次和小样设备条件下，候选经过模拟或真实试验结果校验，等待配方责任人决定；
- 不包含：客户确认、正式报价、量产 BOM、研转产放大、生产投料。

同一熟豆配方用于黑咖、奶咖、咖啡液或冻干时，目标和验证方法不同。最终用途是设计输入，不是备注。

### 1.2 权限

Agent 可以设计新候选、选择试验变量、解释偏差和提出下一轮修订，但不能：

- 伪造实际杯测或理化结果；
- 自动批准主配方；
- 声称客户已经接受；
- 把小样参数直接当成大机参数；
- 授权量产或投料。

## 2. 两次调用组成一个完整运行

### 2.1 调用 A：`design`

输入：本文 + UC 实例 JSON。

输出：`leyin.formula-run-bundle.v2`，包含需求翻译、证据适用性、候选、确定性计算和可执行试验计划。

允许终态：

| `run.status` | 含义 |
|---|---|
| `NEEDS_INPUT` | 缺少会改变研发方向的输入；不得生成候选 |
| `TRIAL_PLAN_READY` | 至少一个候选可以立即进入试验，计划完整 |
| `SOURCE_OR_DATA_REQUIRED` | 设计存在，但当前没有候选能立即试验，需要寻源、替代、检验或设备数据 |

### 2.2 调用 B：`review_trial`

输入：本文 + 原 UC 实例 + 调用 A 的 Run Bundle + 与其中样品 ID 一一对应的 `trial_results`。

输出：同一 `run_id` 的新版本 Run Bundle，必须增加预测校验、候选结论、学习记录和下一步。

允许终态：

| `run.status` | 含义 |
|---|---|
| `RESULTS_INVALID` | 结果缺失、身份不一致、评价条件不可比；不得作质量结论 |
| `REVISION_REQUIRED` | 没有候选达到目标，但结果足以指导下一轮修订 |
| `AWAITING_HUMAN_SAMPLE_DECISION` | 至少一个候选达到当前试验目标，等待配方责任人决定是否进入客户样 |

调用 A 后直接结束，不构成端到端运行。调用 B 没有产生学习记录，也不构成端到端运行。

## 3. 输入合同

### 3.1 UC 实例

实例至少包含：

| 对象 | 必需内容 |
|---|---|
| `metadata` | Case、版本、证据性质、截止时点、外部访问权限 |
| `project_context` | 客户、地点、研发阶段、范围边界 |
| `source_evidence_catalog` | 客户事实和行业知识的来源目录 |
| `request` | 入口、产品、最终用途、卖点、价格、感官目标、禁忌、样数上限、责任人 |
| `benchmark_analysis` | 标样入口的分析结果；需求入口为 `null` |
| `historical_trials` | 历史配方、批次/规格、烘焙方向、预期、实际、方法和决定 |
| `current_material_lots` | 当前批次、准入、库存、成本、理化和批次杯测描述 |
| `decision_knowledge` | 有来源、状态和适用条件的客户经验或行业方法 |
| `trial_resources` | 小样设备、可选烘焙方向、黑咖与真实饮用场景评价协议 |

输入没有提供的事实必须标为未知。不得依据产地名称、常识或历史均值伪造当前批次数值。

### 3.2 `trial_results`

调用 B 的结果对象必须至少包含：

```json
{
  "run_id": "必须等于调用A的run_id",
  "result_mode": "synthetic_replay | real_trial",
  "samples": [
    {
      "sample_id": "必须存在于调用A的trial_plan",
      "formula_fingerprint": "必须与调用A相等",
      "lot_ids": ["必须与调用A相等"],
      "equipment_id": "必须与调用A相等",
      "roast_direction": "必须与调用A相等",
      "contexts": {
        "black": {"panelist_records": []},
        "milk": {"panelist_records": []}
      }
    }
  ]
}
```

样品身份或测试条件不一致时必须进入 `RESULTS_INVALID`，不能把不可比结果硬塞进平均值。

## 4. 事实与推理纪律

每个关键判断使用且只使用一种标签：

| 标签 | 用法 |
|---|---|
| `客户事实` | 乐饮会议、记录或确认需求明确支持的流程和约束 |
| `历史实测` | 特定历史配方、批次、设备和方法下的结果 |
| `行业知识` | 有来源但未必被乐饮正式采用的方法 |
| `模拟数据` | 只用于本次合成验证的业务值 |
| `研发假设` | Agent 提出的、必须被试验推翻或支持的判断 |

规则：

1. 当前豆批优先于同名物料的旧批次；农业原料跨批次不视为恒定。
2. 历史记录必须比较用途、目标、物料规格、烘焙、设备和评价条件；不得只给相似度。
3. “描述出什么风味”和“是否适合客户”分开记录。
4. 每个预测必须有区间、证据和反证条件，不得写成实测事实。
5. 物料不足走替代或寻源分支；设计有价值不等于当前可立即打样。

## 5. 调用 A：设计与试验计划

### Step A0｜冻结输入

生成确定性 `run_id = <case_id>-R1`，记录输入版本、截止时点和证据模式。忽略截止时点后的事实。

### Step A1｜翻译客户目标

按“价值或卖点 → 价格 → 最终用途 → 感官目标 → 工业与供应约束”生成 `target_translation`。

每项必须包含：输入路径、业务含义、测量场景、目标或边界、是否硬约束。无法解释“浓郁、干净、适合奶咖”等语言时进入 `NEEDS_INPUT`，不得原样抄写后继续。

### Step A2｜提取可复用知识

逐条输出历史试验适用性：相同条件、不同条件、预期、实际、可复用结论、不可外推边界。必须读取失败或偏差记录，不能只检索成功样例。

### Step A3｜生成真正不同的候选

数据足够时形成：

- A：稳妥基线；
- B：目标增强；
- C：成本或供应鲁棒。

每个候选必须包含：

- 设计意图；
- 当前物料 `material_family_id + lot_id` 或明确的寻源规格；
- 比例，最多两位小数，显示值合计在 `99.95%–100.05%`；
- 2 kg 小样的逐组分用量；
- 烘焙方向及需要验证的作用；
- 六个目标维度的预测区间；
- 描述词、禁忌风险、加权生豆成本；
- 至少两个证据引用；
- 一个或多个可证伪假设；
- `TRIAL_READY | SOURCE_REQUIRED | DATA_REQUIRED | BLOCKED` 状态。

不得为了凑 A/B/C 只微调比例。任意两个候选至少在两个决策维度上不同。

### Step A4｜执行确定性计算

必须按输入值逐项计算：

```text
ratio_sum_percent = sum(ratio_percent)
component_trial_kg = 2 × ratio_percent / 100
weighted_green_cost = sum(ratio_percent / 100 × lot_cost)
inventory_ok = available_kg >= component_trial_kg
```

禁止静默归一化比例。金额保留两位小数，用量保留三位小数。

如果 `SOURCE_REQUIRED` 或 `DATA_REQUIRED` 候选缺少可验证的当前批次成本、库存或检验值，对应字段和依赖计算必须为 `null`，并列出需要补的数据；不得用 `0` 或相似物料代填。任何含 `null` 依赖值的候选都不能进入本轮试验计划。

### Step A5｜生成物理样品计划

一个物理样是一个独立的“配方版本 × 烘焙方向”组合；本轮新做基线或对照也计一个。黑咖和奶咖是同一样品的两组评价记录，不重复计样。

规则：

- `physical_sample_count <= request.max_first_round_samples`；
- `evaluation_record_count = physical_sample_count × 2`；
- 只有 `TRIAL_READY` 候选能进入本轮样品计划；
- `SOURCE_REQUIRED` 候选可保留设计，但不得伪装成当前样品；
- 每个样品都有三位盲码、公式指纹、物料批次、用量、设备、烘焙方向、唯一变量、假设 ID、黑咖协议和奶咖协议；
- 计划必须包含能回答决策问题的对照，不能用“历史记录存在”代替本轮可比对照。

## 6. 调用 B：结果校验与学习

### Step B0｜验证结果身份

逐样核对 `run_id`、`sample_id`、公式指纹、批次、设备、烘焙方向、评价人数和两个场景。缺失或不一致时输出具体路径并进入 `RESULTS_INVALID`。

### Step B1｜汇总而不抹平分歧

对每个样品、每个场景、每个数值维度计算：

- 中位数；
- 四分位距；
- 与目标上下界的差；
- 是否落入调用 A 的预测区间。

保留三位评价人的原始记录。描述性结果与奶咖适配判断不能混成一个总分。

三位数值升序记为 `v1 <= v2 <= v3`，计算口径固定为：

```text
median = v2
Q1 = (v1 + v2) / 2
Q3 = (v2 + v3) / 2
IQR = Q3 - Q1
target_delta = 0                         median在目标区间内
target_delta = median - target_min       median低于目标下界
target_delta = median - target_max       median高于目标上界
prediction_distance = 0                  median在预测区间内
prediction_distance = 到预测区间最近边界的绝对距离  否则
```

### Step B2｜判定候选

候选只有在指定奶咖场景的六个目标维度全部落入目标区间、禁忌未触发、成本和硬约束仍满足时，才是 `TARGET_MET`。

其他状态：

- `TARGET_MISSED`：证据完整但至少一项不达标；
- `INCONCLUSIVE`：评价分歧或数据质量不足，不能判断；
- `NOT_TESTED`：未进入本轮试验。

### Step B3｜校验预测

逐项输出：预测区间、实际中位数、落区间与否、区间外距离、可能原因。不得用“整体接近”替代。

### Step B4｜形成下一步与学习记录

每个结论必须落到以下之一：

- 保留当前候选，等待配方责任人决定；
- 只修改一个有证据支持的变量后重试；
- 启动替代或寻源；
- 淘汰候选；
- 因分歧或身份问题复测。

每条 `learning_record` 必须包含：适用条件、预期、实际、偏差、被支持或推翻的假设、不可外推边界和来源样品。

## 7. 唯一业务输出：Run Bundle

两次调用都只输出一个合法 JSON 对象，不得在 JSON 前后加解释、日志或 Markdown 围栏。顶层合同如下：

```json
{
  "schema_version": "leyin.formula-run-bundle.v2",
  "run": {
    "run_id": "<case_id>-R1",
    "case_id": "输入case_id",
    "mode": "design | review_trial",
    "status": "本模式允许的状态",
    "evidence_mode": "输入值",
    "evaluation_as_of": "输入值",
    "final_human_role": "输入值"
  },
  "input_assessment": {
    "missing_or_conflicting": [
      {"path": "输入路径", "impact": "为什么会改变设计", "required_action": "需要补什么"}
    ]
  },
  "target_translation": [],
  "evidence_assessment": [],
  "candidates": [],
  "trial_plan": null,
  "trial_evaluation": null,
  "learning_records": [],
  "human_actions": [],
  "authority": {
    "formula_approved": false,
    "customer_confirmed": false,
    "production_authorized": false,
    "human_decision_required": true
  }
}
```

### 7.1 `candidates`

每项至少包含：

```json
{
  "candidate_id": "CAND-A",
  "intent": "baseline | target_enhancement | cost_or_supply_robustness",
  "status": "TRIAL_READY | SOURCE_REQUIRED | DATA_REQUIRED | BLOCKED | TARGET_MET | TARGET_MISSED | INCONCLUSIVE | NOT_TESTED",
  "components": [
    {
      "material_family_id": "输入值",
      "lot_id": "输入值或null",
      "ratio_percent": 0,
      "trial_kg": 0,
      "available_kg": "输入数值或null",
      "cost_cny_per_kg_green": "输入数值或null"
    }
  ],
  "ratio_sum_percent": 0,
  "weighted_green_cost_cny_per_kg": "可复算数值或null",
  "roast_direction": "输入允许枚举",
  "prediction": {
    "context": "milk",
    "scale": "0-5 descriptive intensity",
    "intervals": {"目标维度": {"min": 0, "max": 0}},
    "descriptors": [],
    "forbidden_risks": []
  },
  "evidence_refs": [],
  "hypotheses": [
    {"hypothesis_id": "HYP-A-01", "claim": "可检验判断", "evidence_refs": [], "falsified_when": "可观察条件"}
  ],
  "constraint_checks": []
}
```

### 7.2 `trial_plan`

`NEEDS_INPUT` 或没有可立即试验候选时为 `null`。否则必须包含：

```json
{
  "physical_sample_count": 0,
  "evaluation_record_count": 0,
  "samples": [
    {
      "sample_id": "S01",
      "candidate_id": "CAND-A或CONTROL",
      "formula_fingerprint": "按本节规则生成的SHA-256",
      "components": [],
      "equipment_id": "输入值",
      "roast_direction": "输入值",
      "blind_code": "三位数字字符串",
      "variable_under_test": "本样回答的唯一差异",
      "hypothesis_ids": [],
      "evaluation_contexts": ["black", "milk"]
    }
  ]
}
```

`formula_fingerprint` 的生成规则固定为：

1. 每个组分格式化为 `<material_family_id>@<lot_id>:<ratio_percent固定两位小数>`；
2. 按 `material_family_id`、`lot_id` 升序排列组分；
3. 拼成 `<case_id>|<candidate_id>|<roast_direction>|<组分1,组分2,...>`；
4. 对该 UTF-8 字符串计算小写十六进制 SHA-256。

Runtime、Simulator 和 Validator 必须各自复算，不能信任上游回显。

### 7.3 调用 B 新增内容

`trial_evaluation` 必须至少符合：

```json
{
  "result_mode": "synthetic_replay | real_trial",
  "sample_results": [
    {
      "sample_id": "S01",
      "candidate_id": "CAND-A或CONTROL",
      "identity_status": "MATCHED | MISMATCHED",
      "contexts": {
        "black": {
          "dimensions": {
            "维度": {
              "raw_values": [0, 0, 0],
              "median": 0,
              "iqr": 0
            }
          }
        },
        "milk": {
          "dimensions": {
            "维度": {
              "raw_values": [0, 0, 0],
              "median": 0,
              "iqr": 0,
              "target_delta": 0,
              "prediction_distance": 0
            }
          }
        }
      },
      "forbidden_triggered": [],
      "candidate_outcome": "TARGET_MET | TARGET_MISSED | INCONCLUSIVE | CONTROL"
    }
  ],
  "prediction_metrics": {
    "tested_dimension_count": 0,
    "covered_dimension_count": 0,
    "coverage": 0,
    "mae": 0,
    "forbidden_false_negatives": []
  }
}
```

`learning_records` 不得为空；每项字段按 Step B4 定义，并引用一个实际 `sample_id`。

## 8. 人类视图

Runtime 可以从 Run Bundle 渲染《配方研发建议单》，但渲染器不得新增任何业务事实。所有数字、状态、候选、样品、风险和决定都必须能回指 JSON 路径。

人类视图不参与核心正确性判定；排版再漂亮也不能覆盖结构化结果失败。

## 9. 完成定义

```text
只生成候选或建议书                         ≠ 端到端完成
生成候选 + 可执行试验计划                  = TRIAL_PLAN_READY
收到身份一致的结果 + 完成预测校验          = TRIAL_EVALUATED
形成候选结论 + 学习记录 + 人工下一步        = UC闭环完成
配方责任人选择进入客户样                    = 人工决定完成
客户接受                                    = 另一个下游事实
```
