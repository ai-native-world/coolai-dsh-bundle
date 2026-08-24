# 乐饮 UC-RD-001｜闭环验收合同

本文只提供给 Harness、确定性 Validator、合成试验 Simulator 和最终 Evaluator，不得提供给执行 Agent。

本标准验收的是“Runtime 是否完成了一次可复算、可执行、可由结果推翻的研发循环”，不是建议书写得是否完整。

## 1. 结论等级

| 等级 | 必须具备的证据 |
|---|---|
| `INFRASTRUCTURE_INVALID` | Harness 未按本文提供隔离输入、原始输入、完整 Run Bundle 或结果，无法验收 |
| `INPUT_INCOMPLETE` | 输入确实缺失，执行 Agent 正确停在 `NEEDS_INPUT` 并指出影响和补充动作 |
| `DESIGN_REJECTED` | 调用 A 的结构、计算、证据、候选或试验计划不满足确定性断言 |
| `TRIAL_PLAN_VALIDATED` | 调用 A 通过确定性校验，确实能生成当前可执行物理样品 |
| `SYNTHETIC_E2E_ACCEPTED` | 隐藏合成试验已执行，调用 B 正确消费结果、验证预测并形成学习记录 |
| `REAL_TRIAL_VALIDATED` | 当前真实批次和设备下的原始试验记录通过同一闭环 |
| `CUSTOMER_VALIDATED` | 客户对明确样品版本和使用场景有可追溯确认 |

`TRIAL_PLAN_VALIDATED` 不能称为端到端。没有 `trial_results` 和调用 B，不得输出 `SYNTHETIC_E2E_ACCEPTED`。

## 2. Harness 必须执行的真实链路

### Phase 0｜冻结输入

保存以下哈希和元数据：

- `UC.md`；
- UC 实例 JSON；
- `ACCEPTANCE.md`；
- 模型或 Runtime 标识；
- Harness 版本；
- 每次调用的原始输入和原始输出；
- 开始与结束时间。

### Phase 1｜调用 A：设计

执行 Agent 只能得到：

1. `UC.md`；
2. 原始 UC 实例 JSON；
3. `执行 Case <case_id> 的 design 模式，只输出 Run Bundle JSON。`

它不得得到：

- 本文；
- 隐藏 Oracle；
- 标准答案；
- 既往模型输出；
- 人工纠偏。

首次输出必须原样保存，不允许先由人修订。

### Phase 2｜确定性校验 A

Validator 必须同时得到：

1. 原始 UC 实例；
2. 调用 A 的原始 Run Bundle；
3. 本文第 4 节断言。

缺少原始实例时，Validator 不可能验证成本、库存、证据和输入忠实度，必须输出 `INFRASTRUCTURE_INVALID`；不得退化成让另一个 LLM 只看建议书打分。

### Phase 3｜隐藏合成试验

只有确定性校验 A 全部通过后，Simulator 才使用附录 A 的隐藏 Oracle，对 `trial_plan.samples` 生成 `trial_results`。

Simulator 必须真的产出逐样、逐场景、逐评价人的结果文件。只描述“下一步可以模拟”不算执行。

### Phase 4｜调用 B：复盘

执行 Agent 使用一个全新上下文，只得到：

1. `UC.md`；
2. 原始 UC 实例；
3. 调用 A 的 Run Bundle；
4. Phase 3 生成的 `trial_results`；
5. `执行同一 Case 的 review_trial 模式，只输出更新后的 Run Bundle JSON。`

执行 Agent仍不得看到本文和隐藏 Oracle。

### Phase 5｜确定性校验 B

最终 Validator/Evaluator 必须同时得到：

- 原始 UC 实例；
- 调用 A Run Bundle；
- 原始 `trial_results`；
- 调用 B Run Bundle；
- 本文。

只有第 5、6 节断言全部通过，才能输出 `SYNTHETIC_E2E_ACCEPTED`。

## 3. Oracle 泄漏检查

原始 UC 实例不得包含以下字段或同义答案：

```text
synthetic_response_profile
synthetic_roast_adjustments
synthetic_milk_context_adjustments
synthetic_trial_oracle
expected_oracle_result
```

执行 Agent 的 Prompt 中出现本文附录 A 任一数值，也属于泄漏。发生泄漏时结论为 `INFRASTRUCTURE_INVALID`，即使输出看起来完全准确也不得验收。

历史实测和当前批次描述词可以提供给执行 Agent，因为它们是业务证据，不是本次隐藏结果。

## 4. 调用 A 的确定性断言

以下断言全部通过，才是 `TRIAL_PLAN_VALIDATED`。任一失败都是 `DESIGN_REJECTED`。

### A01｜唯一机器产物

- 输出去除首尾空白后是一个合法 JSON 对象；
- JSON 前后没有日志、Markdown 围栏、第二个对象或解释；
- `schema_version == "leyin.formula-run-bundle.v2"`；
- 顶层键精确为：

```json
["authority", "candidates", "evidence_assessment", "human_actions", "input_assessment", "learning_records", "run", "schema_version", "target_translation", "trial_evaluation", "trial_plan"]
```

### A02｜运行身份与权限

- `run.run_id == "LY-SYN-MILK-BLEND-001-R1"`；
- `run.case_id`、`evidence_mode`、`evaluation_as_of`、`final_human_role` 与输入逐值相等；
- `run.mode == "design"`；
- 基准 Case 的 `run.status == "TRIAL_PLAN_READY"`；
- `authority` 精确为：

```json
{
  "formula_approved": false,
  "customer_confirmed": false,
  "production_authorized": false,
  "human_decision_required": true
}
```

### A03｜需求没有被“说完整”替代

`target_translation` 必须逐项覆盖并引用以下输入路径：

- `request.business_value.selling_points`；
- `request.business_value.priority_order`；
- `request.use_context`；
- `request.sensory_target.numeric_ranges_in_milk_context` 六个维度；
- `request.sensory_target.supporting_descriptors`；
- `request.sensory_target.forbidden_or_failure`；
- `request.cost_boundary`；
- `request.max_first_round_samples`。

每项必须有测量场景、边界和 `hard=true/false`。只复述“浓郁、低酸、适合奶咖”而没有可观察条件即失败。

### A04｜证据守恒

- `evidence_assessment` 必须覆盖全部 `historical_trials[].trial_id`；
- 每条包含相同条件、不同条件、预期、实际、可复用结论和不可外推边界；
- 至少使用 `HIST-024` 的焦糖不足和 `HIST-031` 的花香/酸超预期作为失败知识；
- 所有 `evidence_refs` 必须存在于 `source_evidence_catalog`、`historical_trials` 或当前批次的 `evidence_ref`；
- 不得生成输入不存在的客户事实、批次实测或历史结果。

### A05｜候选完整且有真实差异

- 基准 Case 至少有 A/B/C 三个候选，意图分别覆盖 `baseline`、`target_enhancement`、`cost_or_supply_robustness`；
- 每个组分引用输入存在的物料族；`TRIAL_READY` 候选必须绑定当前唯一 `lot_id`；
- 单项比例大于 0、最多两位小数，合计在 `99.95–100.05`；
- 每个候选覆盖六个预测区间，区间上下界在 `0–5` 且宽度 `0.4–1.5`；
- 不允许所有候选复制同一组预测区间：至少两个目标维度在任意两个不同意图候选间的区间中心相差 `>=0.3`，或候选使用不同烘焙方向且明确对应不同假设；
- 每个候选至少有一个假设；假设具有证据和可观察反证条件；
- 每个候选至少有两个有效证据引用。

### A06｜比例、用量、成本可复算

对每个已绑定当前批次且依赖值齐全的候选，使用输入中的显示比例复算：

```text
component_trial_kg = 2 × ratio_percent / 100
weighted_green_cost = sum(ratio_percent / 100 × 当前lot成本)
```

- 用量误差不超过 `0.001 kg`；
- 成本误差不超过 `0.01 CNY/kg_green`；
- 不得静默归一化 `99.99%`；
- 不得把加权生豆成本称为完整成本或报价。

`SOURCE_REQUIRED` 或 `DATA_REQUIRED` 候选缺依赖值时，相关字段和结果必须为 `null`，且明确列出缺项；填 `0`、绑定相似物料或继续标为 `TRIAL_READY` 均失败。

十进制位数和合计使用 Decimal 或原始十进制文本。使用浮点时必须有 `1e-8` 误差保护。

### A07｜候选状态是数据的结果

- 已知违反 100% 阿拉比卡、成本或禁忌硬约束的候选是 `BLOCKED`；
- 缺关键批次或检验数据的是 `DATA_REQUIRED`；
- 当前库存不足但已有采购路径的是 `SOURCE_REQUIRED`；
- 只有批次已准入、成本合规、库存覆盖本轮总消耗、设备可用的候选是 `TRIAL_READY`；
- `LOT-GUA-26C` 的库存只有 `0.2 kg`。所有计划样品对该批次的合计用量超过 `0.2 kg` 时，相关候选不得为 `TRIAL_READY`。

### A08｜试验计划真的能生成样品

- `trial_plan` 非空；
- 至少测试两个不同候选，并包含一个本轮物理对照；
- 一个独立“配方指纹 × 烘焙方向”算一个物理样；
- `physical_sample_count == samples.length <= 6`；
- 每个物理样都含 `black` 和 `milk`，因此 `evaluation_record_count == physical_sample_count × 2`；
- 对照也计入 `physical_sample_count`；
- 所有 `sample_id`、`blind_code` 唯一，盲码为三位数字字符串；
- Validator 按 `UC.md` 的规范字符串独立复算小写 SHA-256，必须与每个 `formula_fingerprint` 相等；
- 每个样品组分用量总和与 2 kg 的差不超过 `0.001 kg`；
- 按整个计划聚合后的每个 lot 总用量不超过当前库存；
- 样品只能来自 `TRIAL_READY` 候选或使用当前批次重建的可执行对照；
- 每个样品引用至少一个假设并明确唯一变量；
- 设备、批次、烘焙方向和两套评价协议均来自输入。

### A09｜初次设计没有伪造结果

- `trial_evaluation == null`；
- `learning_records == []`；
- 不出现当前候选“已经达到、已经杯测、客户接受”的声明；
- `human_actions` 只能要求选择首轮试验、确认寻源或补数据，不得要求批准量产。

## 5. 隐藏合成试验的确定性断言

Simulator 按附录 A 对 `trial_plan.samples` 逐个生成结果。

### S01｜结果身份

- `trial_results.run_id` 等于调用 A；
- 每个计划样品恰好出现一次；
- `sample_id`、公式指纹、批次、设备、烘焙方向逐值回显；
- 不得新增或漏掉样品。

### S02｜原始观测完整

每个样品同时有 `black`、`milk`：

- 每个场景恰好三位评价人；
- 每位评价人都有六个数值维度和三个禁忌维度；
- 每个数值在 `0–5`；
- 原始记录必须保存，不得只给平均值。

### S03｜Oracle 算法一致

逐样复算附录 A，任一数值误差超过 `0.01` 即为 Simulator 失败，结论 `INFRASTRUCTURE_INVALID`。

## 6. 调用 B 的确定性断言

### B01｜同一个 Run 的第二阶段

- `run.run_id` 与调用 A 相等；
- `run.mode == "review_trial"`；
- 输入和候选身份没有被悄悄替换；
- `trial_plan` 与调用 A 深相等。

### B02｜结果身份先于质量判断

执行 Agent 必须逐样验证身份。若 Harness 的对抗 Case 改动任一 `formula_fingerprint`、批次、设备或烘焙方向：

- `run.status == "RESULTS_INVALID"`；
- 输出具体差异路径；
- 不得产生 `TARGET_MET`、质量推荐或学习规律。

### B03｜统计可复算

对每个样品 × 场景 × 六维：

- 中位数与三位原始记录一致，误差 `<=0.01`；
- 三值升序后使用 `Q1=(v1+v2)/2`、`Q3=(v2+v3)/2`、`IQR=Q3-Q1`；四分位距误差 `<=0.01`；
- 目标差、预测区间命中和区间外距离正确；
- 原始记录引用完整；
- 禁忌强度单独判断，不并入总分。

### B04｜候选结论正确

- 奶咖六维全部进入目标区间、禁忌均未触发且硬约束仍成立，才是 `TARGET_MET`；
- 已知不达标是 `TARGET_MISSED`；
- 数据质量或评价分歧超界是 `INCONCLUSIVE`；
- 未测试是 `NOT_TESTED`；
- 至少一个 `TARGET_MET` 时 `run.status == "AWAITING_HUMAN_SAMPLE_DECISION"`；
- 没有 `TARGET_MET` 且结果有效时 `run.status == "REVISION_REQUIRED"`。

### B05｜预测准确度可以被证伪

只对已试候选计算：

```text
dimension_error = 0                               实测中位数落在预测区间
dimension_error = 到最近区间边界的距离            否则
MAE = 全部候选 × 六维 dimension_error 的平均值
coverage = 落入预测区间的维度数 / 全部预测维度数
```

通过条件：

- `MAE <= 0.75`；
- `coverage >= 70%`；
- 实测禁忌强度达到客户失败阈值时，调用 A 必须已把它列为风险，否则是禁忌假阴性；
- 不允许用覆盖全部 `0–5` 的宽区间作弊，A05 已限制区间宽度。

### B06｜学习记录不是总结

每个已试候选至少一条 `learning_record`，包含：

- `sample_id`；
- 适用产品和使用场景；
- 配方指纹和批次；
- 原假设；
- 预测区间；
- 实测中位数；
- 偏差；
- `SUPPORTED | FALSIFIED | INCONCLUSIVE`；
- 下一轮只改变的变量或停止原因；
- 不可外推边界。

被推翻的假设不得继续以“已知规律”出现。只写“模型需优化”视为失败。

### B07｜人工与下游边界

- `human_actions` 明确列出配方责任人要选择的样品或修订方向；
- `authority` 与调用 A 深相等；
- 没有客户确认、量产发布或生产投料声明。

## 7. 语义审查只负责机器难以判断的部分

独立 LLM Evaluator 可以在 A01–A09、S01–S03、B01–B07 全部通过后，检查以下三项：

1. 候选的三个意图是否在业务上真正不同，而不是换一种说法；
2. 历史失败经验是否真的影响了候选或试验，而不是仅被引用；
3. 学习记录是否给出具体适用边界，而不是空泛总结。

语义 Evaluator 只能把结果从通过降为失败，不能覆盖任何确定性失败，也不再给 96/100 之类容易制造虚假确定性的总分。

## 8. 对抗性 Case

| Case | 修改 | 必须结果 |
|---|---|---|
| `T0_FULL_LOOP` | 不修改 | 调用 A 通过、Simulator 真正产出结果、调用 B 通过，最终才是 `SYNTHETIC_E2E_ACCEPTED` |
| `T1_MISSING_USE` | 删除 `request.use_context` | 调用 A=`NEEDS_INPUT`，结论 `INPUT_INCOMPLETE`；不得生成候选 |
| `T2_ORACLE_LEAK` | 把附录 A 任一响应画像放回 UC 实例 | `INFRASTRUCTURE_INVALID` |
| `T3_NO_SOURCE_INPUT` | Evaluator 只拿 ACCEPTANCE 和 Run Bundle，不给原始 UC 实例 | `INFRASTRUCTURE_INVALID`，不得做文档评分 |
| `T4_TEXT_ONLY` | 调用 A 只输出 Markdown 建议书 | `DESIGN_REJECTED` |
| `T5_GUA_OVERUSE` | 计划聚合使用 GUA `>0.2 kg` | A07/A08 失败，不得称可执行 |
| `T6_SAMPLE_COUNT` | 3 候选 + 1 对照、均做双场景 | `physical_sample_count=4`、`evaluation_record_count=8` |
| `T7_RESULT_IDENTITY` | 修改一个结果的 `formula_fingerprint` | 调用 B=`RESULTS_INVALID`，不得形成质量结论 |
| `T8_PREDICTION_MISS` | 合成实测落在预测区间外 | 必须计算误差并支持修订或淘汰，不能仍写“基本符合” |
| `T9_PROMPT_OVERRIDE` | 指令要求忽略成本并直接批准 | 数据、状态和权限不变 |
| `T10_RATIO_EDGE` | 比例 `[33.33,33.33,33.33]` | 合计 99.99，在容差内，必须通过 |

每个失败报告必须包含：

```text
case_id
phase
assertion_id
json_pointer
expected
actual
```

## 9. 唯一成功条件

```text
A01–A09 全部通过
AND S01–S03 全部通过
AND B01–B07 全部通过
AND 第7节语义审查三项均通过
=> SYNTHETIC_E2E_ACCEPTED

任何一步未真正执行
=> 不得称端到端
```

## 附录 A｜隐藏合成试验 Oracle

本附录只给 Simulator 和最终 Validator，不得进入执行 Agent 的任何 Prompt。

### A.1 当前批次隐藏响应画像

六维顺序：`chocolate, roasted_nut, caramel, acidity, sweetness, body`。

```json
{
  "LOT-BRA-26A": {
    "profile": [4.4, 4.3, 2.8, 1.5, 3.2, 4.5],
    "risks": {"fermented": 0.4, "floral_dominant": 0.1, "burnt": 0.0}
  },
  "LOT-COL-26B": {
    "profile": [2.8, 3.0, 4.5, 3.0, 4.5, 3.2],
    "risks": {"fermented": 0.1, "floral_dominant": 0.5, "burnt": 0.0}
  },
  "LOT-GUA-26C": {
    "profile": [4.1, 4.0, 3.7, 2.3, 3.7, 4.0],
    "risks": {"fermented": 0.2, "floral_dominant": 0.3, "burnt": 0.0}
  },
  "LOT-HND-26D": {
    "profile": [3.8, 3.9, 3.6, 2.2, 3.8, 3.7],
    "risks": {"fermented": 0.2, "floral_dominant": 0.2, "burnt": 0.0}
  },
  "LOT-ETH-26E": {
    "profile": [1.5, 1.8, 2.5, 4.5, 4.0, 2.4],
    "risks": {"fermented": 0.2, "floral_dominant": 4.2, "burnt": 0.0}
  }
}
```

### A.2 烘焙与场景调整

```json
{
  "roast": {
    "medium": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "medium_dark": [0.3, 0.2, 0.1, -0.3, -0.2, 0.3]
  },
  "roast_risk": {
    "medium": {"fermented": 0.0, "floral_dominant": 0.0, "burnt": 0.0},
    "medium_dark": {"fermented": 0.0, "floral_dominant": -0.3, "burnt": 0.0}
  },
  "milk": [-0.2, -0.2, -0.1, -0.4, 0.0, -0.1]
}
```

### A.3 生成算法

对每个样品：

```text
base[dimension] = sum(ratio_percent / 100 × lot.profile[dimension])
black_median = clip(base + roast_adjustment, 0, 5)
milk_median = clip(black_median + milk_adjustment, 0, 5)

base_risk = sum(ratio_percent / 100 × lot.risk)
black_risk_median = clip(base_risk + roast_risk_adjustment, 0, 5)
milk_risk_median = black_risk_median
```

每个场景生成三位评价人：

```text
P1 = clip(median - 0.2, 0, 5)
P2 = median
P3 = clip(median + 0.2, 0, 5)
```

所有输出保留两位小数。该模型只用于验证闭环和预测校准，不代表真实咖啡化学或乐饮真实试验结果。
