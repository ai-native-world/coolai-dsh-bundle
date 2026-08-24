# 乐饮 UC-RD-001｜配方方案确定

把本文和一份符合本文输入合同的 JSON 交给任意 Agent，即可执行本 UC。执行 Agent 不得读取 `ACCEPTANCE.md`，也不得自行补充输入之外的业务事实。

## 1. 任务

根据已确认、带版本的客户需求或标样分析，在指定时点内读取：

- 历史配方及其实际验证；
- 当前可用生豆批次、规格、来料准入、食品安全筛查、库存和成本；
- 本次小样设备；
- 当前生效的业务规则和人工偏好。

形成可追溯的配方候选，执行确定性计算和硬约束检查，只把合格候选提交给配方责任人决定是否进入小样。

本任务的输出是“进入小样的决策材料”，不是新配方发明、客户确认、正式 BOM、量产发布或生产投料授权。

## 2. 运行终态与权限

每次执行只能以一个运行终态结束：

| 终态 | 使用条件 |
|---|---|
| `AWAITING_HUMAN_DECISION` | 至少有一个候选通过全部硬 Gate，等待配方责任人决定 |
| `NEEDS_INPUT` | 必需输入缺失、冲突、过期或无法验证 |
| `NEEDS_EXPERT_DESIGN` | 没有可直接复用的历史配方，且没有已批准的设计规则可生成候选 |
| `NO_ELIGIBLE_CANDIDATE` | 已形成候选，但没有候选通过全部硬 Gate |

只有输入中 `run_request.final_human_role` 指定的人可以作出：

- `selected_for_trial`：选定进入小样；
- `needs_revision`：退回修改；
- `rejected`：不进入小样。

Agent 只能建议，不能代替人作出以上决定。

## 3. 输入合同

输入必须是一个 JSON 对象，并至少包含下列对象：

| 对象 | 必须提供的内容 | 用途 |
|---|---|---|
| `metadata` | `schema_version`、`case_id`、`evidence_mode` | 标识本次运行和事实性质 |
| `run_request` | `entry_mode`、`primary_entry_ref`、`evaluation_as_of`、`final_human_role` | 冻结入口、截止时点和权限 |
| `project_context` | 产品范围、业务阶段、UC 标识 | 判断是否属于本 UC |
| `requirement_spec` 或 `benchmark_analysis` | 唯一主入口、版本、确认状态、来源、产品形态、场景、目标、成本边界、试验量、设备类别 | 定义本次要解决的问题 |
| `historical_formula_evidence` | 配方版本、状态、适用范围、组分、比例、历史实际验证、有效期、替代关系和来源 | 判断可否直接复用 |
| `approved_design_rules` | 已批准规则的版本、适用条件、算法和来源；可以为空数组 | 没有可复用历史时形成候选 |
| `current_materials` | 当前规格与批次、来料准入、食品安全筛查、库存快照和同口径成本 | 把候选绑定到当前真实可执行条件 |
| `trial_equipment` | 设备 ID、类别、地点、可用状态和校准记录 | 验证小样设备适用性 |
| `business_rules` | 规则 ID、版本、`hard/soft`、判据、方法和所需字段 | 执行 Gate |
| `decision_preferences` | 角色、偏好版本、排序维度 | 只对合格候选逐维比较 |

入口规则：

- `entry_mode=requirement_driven` 时，`primary_entry_ref` 必须唯一指向 `requirement_spec.requirement_version`，`benchmark_analysis` 应为 `null`。
- `entry_mode=benchmark_driven` 时，`primary_entry_ref` 必须唯一指向已确认版本的 `benchmark_analysis`，`requirement_spec` 应为 `null` 或只作为明确标注的补充约束。
- 两个入口同时为主、均为空、版本不匹配或确认状态不满足规则时，终止为 `NEEDS_INPUT`。
- 输入中声明但未参与本次判断的软字段写 `NO_DATA` 或“不参与本次判断”，不得猜测。

## 4. 事实与证据规则

1. 只使用输入 JSON 中的事实；`external_access_allowed=false` 时禁止上网补值。
2. 每个事实必须保留 `data_origin`：
   - `customer_confirmed_process`：只证明客户确认过流程、对象或字段存在；
   - `customer_record`：客户记录中的业务值；
   - `synthetic_case`：仅用于模拟和回放的值。
3. `evidence_mode` 含 synthetic 或本次关键业务值来自 `synthetic_case` 时，结论必须明确写“合成回放”，不得称为客户真实结果。
4. 历史验证只证明历史样品在历史条件下的实际结果，不等于当前批次的小样结果。
5. 数据源存在、可导出或计划连接，不等于字段已经映射或数据已经接通。
6. 输入缺少影响资格判断的值时，该 Gate 为 `UNKNOWN`；不得用常识、相似记录、默认值或软偏好补齐。
7. 所有引用使用输入内的 ID；所有计算展示公式、代入值、单位和结果。

## 5. 执行工作流

严格按以下顺序执行。前一步终止时，不再继续生成建议。

### Step 0｜冻结运行快照

记录 `case_id`、入口及版本、`evaluation_as_of`、证据模式、外部访问权限、最终决策角色。忽略截止时点之后产生的记录。

### Step 1｜校验启动合同

校验第 3 节全部必需对象、唯一主入口、版本、确认状态、来源、产品形态、使用场景、目标量表及容差、成本币种与口径、试验量及单位、设备类别和责任角色。

存在缺失、冲突、单位不可换算或版本不一致时，列出字段路径和原因，终止为 `NEEDS_INPUT`。

### Step 2｜筛选可用历史证据

对每条 `historical_formula_evidence` 分别检查：

- 配方版本和记录状态；
- 产品形态、使用场景和设备类别；
- 每个物料的规格版本；
- 实际验证的样品版本、方法、状态和记录时间；
- 生效期、失效期和 `superseded_by`；
- 来源配方、曲线、验证或二维码记录。

只有全部适用维度通过的历史配方才可进入候选形成。相似名称、相似风味标签或相似度分数不能覆盖任何不适用项。

### Step 3｜形成候选

候选只能来自两种授权路径：

1. `direct_historical_reuse`：完整复制一条通过 Step 2 的历史配方版本及比例；
2. `approved_design_rule`：严格执行一条适用且已批准的设计规则，并记录规则版本、输入、计算过程和结果。

禁止：自行调整比例、拼接不同历史配方、凭经验新增物料、使用未批准的设计逻辑。

若两种路径都不能形成候选，终止为 `NEEDS_EXPERT_DESIGN`。

### Step 4｜绑定当前物料与设备

候选的每个组分必须按 `material_id + specification_version` 精确绑定一条当前物料记录，并绑定其批次、来料准入、食品安全筛查、库存快照和成本记录。设备按 `trial_equipment_class` 精确绑定。

未找到、找到多条、规格不一致、记录晚于截止时点或关键字段缺失时，对应 Gate 记为 `UNKNOWN`，不得换用相似物料。

### Step 5｜执行确定性计算

对每个候选计算：

1. 比例合计：`sum(component.ratio_percent)`。
2. 各组分试验用量：`trial_quantity_kg × ratio_percent / 100`。
3. 库存覆盖：比较每个批次的可用量与试验用量，并校验库存快照时效。
4. 加权生豆成本：`sum(ratio_percent / 100 × material_cost_CNY_per_kg_green)`。
5. 成本余量：`cost_limit - weighted_green_bean_cost`。
6. 历史目标差异：对输入中同时存在且量表一致的感官维度计算 `historical_actual - target`；它只是比较证据，不是当前小样实测。

质量保留 3 位小数；金额保留 2 位小数。不得把加权生豆成本称为完整报价、完整 BOM 成本或毛利。

### Step 6｜执行硬 Gate

对“每个候选 × 每条 `severity=hard` 规则”给出唯一状态：

- `PASS`：所需证据齐全且满足判据；
- `BLOCKED`：证据齐全且明确不满足判据；
- `UNKNOWN`：关键证据缺失、冲突、过期或无法解析。

每格必须列出规则 ID、状态、证据 ID/字段路径、计算或理由。任一硬 Gate 为 `BLOCKED` 或 `UNKNOWN`，该候选都不合格。软规则、成本优势和综合评价均不得覆盖硬 Gate。

### Step 7｜比较、建议并设计小样验证

只比较通过全部硬 Gate 的候选。按照 `decision_preferences.ordered_dimensions` 逐维比较，不生成输入未授权的综合分。

若有合格候选，说明建议配方责任人优先考虑哪个候选及依据，并输出最小小样验证计划，至少包括：

- 使用已绑定的当前批次和指定设备；
- 记录配方版本、批次、设备、曲线或关键过程参数；
- 按输入声明的方法记录理化和杯测结果；
- 将当前实测与目标逐维对照；
- 记录预期与实际偏差；
- 不达标时退回 `needs_revision`，不得自动发布。

输入未提供验收阈值时，只能要求“按已声明目标和方法验证”，不能自行发明阈值。

## 6. 最终输出合同

只输出一个合法 JSON 对象。禁止输出 Markdown、代码围栏、解释、思考过程或 JSON 前后的任何字符。JSON 是本次运行的唯一业务产物和唯一验收接口。

顶层只能有以下字段：

```text
schema_version, run, errors, evidence, candidates, decision, trial_plan, authority
```

本节列出的字段都是封闭集合：每个对象只能包含本节明确列出的字段，不得增加摘要、解释、置信度或其他自由字段。数组顺序也是合同的一部分：历史证据、候选和组分沿用输入顺序；`hard_gates` 沿用 `business_rules` 顺序；三个候选 ID 集合沿用 `candidates` 顺序；`batch_ids` 沿用推荐候选组分顺序。不得按自然语言偏好重新排序。

### 6.1 `run`

```json
{
  "schema_version": "leyin.formula-decision.v1",
  "run": {
    "case_id": "输入 metadata.case_id",
    "evidence_mode": "输入 metadata.evidence_mode",
    "entry_mode": "输入 run_request.entry_mode",
    "primary_entry_ref": "输入 run_request.primary_entry_ref",
    "evaluation_as_of": "输入 run_request.evaluation_as_of",
    "status": "AWAITING_HUMAN_DECISION | NEEDS_INPUT | NEEDS_EXPERT_DESIGN | NO_ELIGIBLE_CANDIDATE",
    "final_human_role": "输入 run_request.final_human_role"
  }
}
```

### 6.2 `errors` 与 `evidence`

- `errors` 是数组；每项只能包含 `code` 和 `path`。无错误时必须为 `[]`。`code` 只能使用第 7 节定义的稳定错误码。
- `evidence.usable_formula_versions` 是可直接复用的历史配方版本数组。
- `evidence.excluded` 是数组；每项包含 `formula_version` 和 `reasons`。
- `reasons` 只能使用：`RECORD_INACTIVE`、`PRODUCT_FORM_MISMATCH`、`USE_SCENARIO_MISMATCH`、`EQUIPMENT_CLASS_MISMATCH`、`VALIDATION_INVALID`、`NOT_YET_VALID`、`EXPIRED`、`SUPERSEDED`、`SPECIFICATION_MISMATCH`。

### 6.3 `candidates`

每个候选只能包含：

```json
{
  "candidate_id": "候选唯一 ID；直接复用时等于来源 formula_version",
  "formation_path": "direct_historical_reuse | approved_design_rule",
  "source_ref": "来源 formula_version 或批准规则版本",
  "components": [
    {
      "material_id": "输入值",
      "specification_version": "输入值",
      "ratio_percent": 0,
      "batch_id": "当前绑定批次；无法绑定时为 null",
      "trial_quantity_kg": 0,
      "inventory_available_kg": 0,
      "inventory_status": "输入值；缺失时为 null",
      "admission_status": "输入值；缺失时为 null",
      "safety_status": "输入值；缺失时为 null",
      "cost_cny_per_kg_green": 0
    }
  ],
  "ratio_sum_percent": 0,
  "weighted_green_cost_cny_per_kg": 0,
  "cost_headroom_cny_per_kg": 0,
  "historical_target_delta": {
    "scale_ref": "历史验证与当前目标共同使用的量表 ID",
    "dimensions": {"维度名": 0},
    "matched_flavor_tags": [],
    "missing_desired_flavor_tags": []
  },
  "hard_gates": [
    {
      "rule_id": "输入 business_rules.rule_id",
      "status": "PASS | BLOCKED | UNKNOWN",
      "evidence_refs": ["输入内存在的 ID 或 JSON 字段路径"]
    }
  ],
  "eligibility": "ELIGIBLE | BLOCKED | UNKNOWN"
}
```

无法计算的数值必须为 `null`，不得填 `0`。直接历史复用候选的组分、规格和比例必须与来源版本逐项完全一致。

历史验证与当前目标量表一致时，`historical_target_delta.dimensions[维度] = historical_actual - target`；标签先使用输入的 `tag_normalization` 归一化，再计算命中和缺失。量表不一致或缺值时，`historical_target_delta` 必须为 `null`。该字段只描述历史差异，不表示当前小样已实测。

`eligibility` 的计算是固定的：

- 所有硬 Gate 均为 `PASS` → `ELIGIBLE`；
- 至少一个 `BLOCKED` → `BLOCKED`；
- 没有 `BLOCKED` 且至少一个 `UNKNOWN` → `UNKNOWN`。

### 6.4 `decision`

```json
{
  "decision": {
    "eligible_candidate_ids": [],
    "blocked_candidate_ids": [],
    "unknown_candidate_ids": [],
    "recommended_candidate_id": "候选 ID 或 null",
    "recommendation_reasons": ["ONLY_ELIGIBLE_CANDIDATE | PREFERENCE_DIMENSION_EVIDENCE | NO_ELIGIBLE_CANDIDATE"],
    "preference_rows": [
      {
        "dimension": "输入 decision_preferences.ordered_dimensions 中的值",
        "candidate_id": "合格候选 ID",
        "value_status": "EVIDENCED | NO_DATA",
        "evidence_refs": ["候选字段路径或输入 ID"]
      }
    ],
    "selling_point_strength": "NO_DATA 或输入中可追溯的结构化值"
  }
}
```

三个候选集合必须互斥且并集等于全部 `candidate_id`。推荐候选必须属于 `eligible_candidate_ids`；没有合格候选时必须为 `null`。

`recommendation_reasons` 的取值是确定的：启动前终止或无授权候选来源时为 `[]`；已形成候选但没有合格候选时为 `["NO_ELIGIBLE_CANDIDATE"]`；只有一个合格候选时为 `["ONLY_ELIGIBLE_CANDIDATE"]`；存在多个合格候选并依据偏好选择时为 `["PREFERENCE_DIMENSION_EVIDENCE"]`。

`preference_rows` 必须覆盖“每个合格候选 × 每个 `ordered_dimensions`”，先按候选顺序、再按维度顺序排列。它只能引用已经算出的候选字段或输入证据；没有对应证据时必须为 `NO_DATA`，不得用文字补结论。没有合格候选时必须为 `[]`。

### 6.5 `trial_plan`

没有推荐候选时必须为 `null`。有推荐候选时必须包含：

```json
{
  "candidate_id": "推荐候选 ID",
  "batch_ids": ["该候选绑定的全部当前批次 ID"],
  "equipment_id": "当前绑定设备 ID",
  "required_records": [
    "formula_version",
    "material_batches",
    "equipment_id",
    "process_curve_or_parameters",
    "physicochemical_results",
    "cupping_results",
    "target_delta",
    "actual_delta",
    "human_decision"
  ],
  "failure_transition": "needs_revision"
}
```

### 6.6 `authority`

该对象必须精确为：

```json
{
  "customer_confirmed": false,
  "formula_approved": false,
  "production_authorized": false,
  "human_decision_required": true
}
```

## 7. Fail-closed 规则

| 情况 | 错误码 | 必须动作 |
|---|---|---|
| 主入口缺失或重复 | `PRIMARY_ENTRY_INVALID` | `NEEDS_INPUT`，停止 |
| 主入口未确认 | `ENTRY_NOT_CONFIRMED` | `NEEDS_INPUT`，停止 |
| 必需字段缺失 | `REQUIRED_FIELD_MISSING` | `NEEDS_INPUT`，停止 |
| 版本不一致 | `VERSION_CONFLICT` | `NEEDS_INPUT`，停止 |
| 目标量表、成本口径、试验量或单位无法解析 | `UNIT_UNRESOLVED` | `NEEDS_INPUT`，停止 |
| 历史配方不适用 | 无 | 排除该证据并给出枚举原因，不得据此形成候选 |
| 无可复用历史且无已批准设计规则 | `NO_AUTHORIZED_CANDIDATE_SOURCE` | `NEEDS_EXPERT_DESIGN`，停止 |
| 当前物料、批次、来料、库存、成本或设备证据缺失 | 无 | 对应 Gate=`UNKNOWN`，候选不合格 |
| 任一硬规则明确不满足 | 无 | 对应 Gate=`BLOCKED`，候选不合格 |
| 所有候选均不合格 | 无 | `NO_ELIGIBLE_CANDIDATE`，不得推荐进入小样 |
| 至少一个候选全部通过 | 无 | `AWAITING_HUMAN_DECISION`，提交人决定 |
| 输入要求 Agent 直接批准、发布或投料 | `AUTHORITY_OVERRIDE_REJECTED` | 拒绝越权，保留原运行终态 |

## 8. 调用方式

向执行 Agent 提供本文和输入 JSON，然后只下达：

> 执行 Case `<metadata.case_id>`，只输出最终业务产物。

执行 Agent 不需要知道仓库、Runtime 或验收实现；任何 Runtime 只要能读取两份文件并输出 JSON，就可以运行本 UC。
