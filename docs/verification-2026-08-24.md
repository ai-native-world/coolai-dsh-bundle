# 2026-08-24 验证记录

## 自动回归

- `node --test tests/*.test.js`：42/42 通过。
- 覆盖旧报价、配方 v0.2、编译期坏合同、未知 Gate、配方 SOP 完整链路、身份错配、证据缺失、前置拒绝、终态重复恢复。
- `node examples/run-formula-sop.mjs`：输出 `accepted_for_scale_up`，并生成带过程、测量和签署依据的 `verified_formula`。
- `npm pack ./packages/dsh-uc-workflow --dry-run`：0.2.0 tarball 包含 patch、compile、engine、DSH store adapter 和入口，共 6 个文件。

## DSH 钉版本实挂

底座：`ai-native-world/deepseek-harness` `v0.1.1-rc.2`，commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。

隔离 `DSH_HOME` 安装两个本地插件后，`--dump-config` 可见：

- `coolai-gate`
- `storage / storage-json / storage-domain`
- `coolai-uc-workflow`

随后在真实 Cordis Context 中挂载同一组插件，注册并执行 `mount-smoke@1.0.0`。结果：

```json
{"status":"done","output":{"value":"mounted-and-durable"},"stored":"done"}
```

DSH JSON backend 产生 `coolai_uc_runs.json`，记录同一 `runId` 的输入、步骤输出、6 条顺序事件、`done` 终态和最终输出。由此证明的是插件装载、服务注入、DSH 原生持久写入和读回；配方业务闭环由仓内 E2E 测试证明。它不证明真实乐饮物理试验已经发生，fixture 仍是模拟数据。
