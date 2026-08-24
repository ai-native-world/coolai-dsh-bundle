# 确定性 UC Workflow 合同 v0.2

## 这是什么

它是“一个 UC 全家桶”的最小运行合同：任何 runtime 只要能注册函数、模型和 Gate，并实现 `execute/resume`，就能运行同一份 UC Package。它不负责自由编排子 Agent，也不把测试绿灯等同于业务成功。

一个 Package 只包含四类资产：

1. `inputSchema/outputSchema`：实例输入和最终业务产物的边界。
2. `steps/transitions`：预定义、版本化、可分支的 SOP。
3. `function/model/human/input` executor：分别表示确定性计算、模型产出、责任人决定、外部系统或物理世界回填。
4. Gate 与 tests：前者是运行时准入条件，后者证明 Gate 能拦住反例。

## Run 状态机

```text
running ── human step ──> wait_human ── resume ──> running
   │
   ├──── input step ───> wait_input ─── resume ──> running
   │
   ├──── contract/gate failure ─────────────────> failed
   └──── output schema + output gates pass ─────> done
```

- `runId` 从创建到终态保持不变。
- 每个步骤结束、每次暂停和每个终态都写入检查点。
- runtime 重启后必须重新注册相同 `workflowId@version`，再按 `runId` 恢复。
- `done` 只表示合同完整执行；业务结果仍由输出中的业务状态表达，例如 `accepted_for_scale_up/needs_revision/rejected`。
- 失败试验不在原 Run 内自动改配方。下一候选版本必须新建 Run，并引用前一 Run 的失败证据，以免覆盖审计历史。

## 为什么不直接复用 DSH 原生 workflow

DSH 原生 workflow 面向模型临时编写 JavaScript 并扇出子 Agent。钉死版本的官方说明明确写明：只有前台运行，没有日志化、检查点或进程恢复，也没有保存的工作流。它适合动态研究/迁移编排；本插件负责预定义 UC SOP，两者互补而不是替代。

- DSH workflow 文档：<https://github.com/ai-native-world/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/workflow/workflow/README.zh.md>
- DSH storage-domain 文档：<https://github.com/ai-native-world/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/subsystems/storage.md>

## 配方 SOP 的验收边界

当前 `formula-development-validation-sop@0.3.0` 从需求与历史证据开始，到“小样已验证可进入生产放大”结束；生产放大本身属于下一个 UC。

必须满足：候选通过硬约束；责任人明确选择；试验计划冻结候选、物料批次、设备和目标；回填真实过程与测量记录；实际身份与计划一致；每个目标逐项通过；责任人按角色签署。任何身份错配、缺值或偏差只能得到 `needs_revision`，不得产生 `verified_formula`。
