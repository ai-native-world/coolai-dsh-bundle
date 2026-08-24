# v0.2 包移植验收记录（formula-candidate-reference → @coolai/dsh-uc-workflow）

> 日期：2026-08-24 · 样本：曹天航 uc-rd-001-formula-reference-v0.2.0-leyin-process（synthetic）
> 引擎：@coolai/dsh-uc-workflow v3（JS），对照 Python formula_capabilities.py 逐字段对齐
> 位置：coolai-bundle/instances/formula-reference/ + tests/formula.test.js

## 结论

9 个测试用例全部通过，与 test-cases.yaml expect 逐项一致。
全仓 31 项测试全绿（乐饮五步 5 + 乐饮纯函数 6 + 编译反例 10 + formula 9 + 其他 1）。

## 用例对照表

| # | 用例 | 期望 | 结果 |
|---|------|------|------|
| 1 | test-requirement-happy | SUCCEEDED / selected_for_trial / SYN-CAND-ESP-014-v3 | ✅ |
| 2 | test-hard-block-rejected | SUCCEEDED / rejected / eligible=[] | ✅ |
| 3 | test-missing-top-level-input | FAILED / INPUT_SCHEMA_INVALID / 0 步 | ✅ |
| 4 | test-incomplete-requirement | FAILED / INPUT_SCHEMA_INVALID / 0 步 | ✅ |
| 5 | test-unknown-constraint | FAILED / INPUT_SCHEMA_INVALID / 0 步 | ✅ |
| 6 | test-invalid-human-selection | FAILED / GATE_FAILED | ✅ |
| 7 | test-context-mismatch-needs-design | SUCCEEDED / needs_revision / needs_expert_design / 候选空 | ✅ |
| 8 | test-spec-mismatch-needs-design | SUCCEEDED / needs_revision / needs_expert_design | ✅ |
| 9 | test-decision-package-is-complete | SUCCEEDED / 候选详情 5 字段齐全 | ✅ |

## 引擎补的缺口（被 v0.2 包逼出的）

1. 运行期输入 schema 校验：INPUT_SCHEMA_INVALID、steps_started: 0、任何步骤启动前失败
2. human executor：挂起 wait_human → resume(runId, humanInput) 注入决定后继续执行
3. 声明式 Gate（path/operator/value：non_empty/truthy/eq/in/present）＋ on_fail 信号映射
4. input_gates / output_gates 作用域
5. capability_ref executor 形态兼容（`ref ?? capability_ref`）

## 移植保真度说明

- 7 个能力函数（normalize/retrieve/generate/evaluate/compare/validate + _target_check）逐字段对齐，含 Python 银行家舍入（pyRound）、Python falsy 语义（isPyFalsy）、排序键（target_penalty → cost → 稳定 ID）
- 已知差异（如实标注）：
  · evidence 文本字符串与 Python 版语义一致但非逐字节保证（不影响任何用例断言）
  · format: date/date-time 校验未实现（Python jsonschema 默认同样不强制 format）

## 遗留问题（待曹天航确认）

- test-unknown-constraint 口径变化（v0.1 运行时 UNKNOWN → v0.2 运行前 Schema 拒绝）：POC 按 v0.2 执行，真实客户落地建议回调为运行时语义并标出不确定项交给人。
- formula 实例尚未挂载进 dsh headless profile（当前在纯 JS 测试环境跑通）；挂载验证列入 D5 动作。

## 映射文件

- instances/formula-reference/workflow.js（7 步合同，含 inputSchema/outputSchema/outputMapping）
- instances/formula-reference/gates.js（9 个声明式 Gate）
- instances/formula-reference/functions.js（7 个能力函数）
- instances/formula-reference/fixtures/（6 个 fixture，原包复制）
- tests/formula.test.js（9 用例）
