# coolai-dsh-bundle

酷爱 bundle —— deepseek-harness（dsh）生态的确定性 UC 工作流插件集。

DSH 底座 POC 产物（2026-08-24）：把“确定性 UC 工作流合同”做成 dsh 的 cordis 插件。
它承载预定义 UC 的严格 I/O、分支 SOP、持久 Run、外部/人工回填、Gate 与业务验收；
不替代 DSH 自带的动态 subagent workflow。

## 插件

| 包 | 作用 | 服务 |
|---|---|---|
| `packages/dsh-gate` | 函数式/声明式 Gate 注册表；未知 Gate fail-closed | `ctx.ucGates` |
| `packages/dsh-uc-workflow` | 确定性 UC 引擎：严格合同、四类 executor、DSH 原生持久层、同 Run 暂停恢复、审计轨迹 | `ctx.ucWorkflow` |

## 实例（UC 是数据，不是代码）

| 实例 | 域 | 状态 |
|---|---|---|
| `instances/leyin-quote` | 乐饮报价五步（需求解析→成本归集→产能推演→报价决策→产出报价单） | 15 项测试全绿 |
| `instances/formula-reference` | 配方方案确定七步（UC-RD-001，曹天航 v0.2 样本移植） | 9/9 用例通过 |
| `instances/formula-validation-sop` | 配方开发与小样验证：候选→试验计划→真实结果→逐项验收→责任人签署 | E2E + 对抗性反例通过 |
| `instances/leyin-formula-agent/UC.md` | 乐饮熟豆拼配研发：客户需求→候选与小样→真实评价→校正复盘 | 单文档可执行 UC v4；Mock 仅作测试输入 |

## 测试

```bash
node --test tests/*.test.js
node examples/run-formula-sop.mjs
```

当前 42 项：旧 UC 回归、编译 fail-closed、Gate fail-closed、配方 SOP E2E、跨引擎恢复和业务反例。
完整合同与边界见 [`docs/uc-workflow-contract.md`](docs/uc-workflow-contract.md)。

## 挂载到 dsh

```bash
# 依赖 dsh 仓库（版本钉死在 README 附录）
pnpm dsh plugin --profile headless add "file:<本仓>/packages/dsh-gate"
pnpm dsh plugin --profile headless add "file:<本仓>/packages/dsh-uc-workflow"
pnpm dsh --profile headless --dump-config
```

插件 = cordis 插件（export name/inject/apply）；bundle 声明在 package.json
`dsh.bundle.patch` → cordis.patch.yml。workflow 插件会同时挂载 DSH 的 `storage/storage-json/storage-domain`，
Run 检查点保存在 `dshHomePath('storages')/coolai_uc_runs.json`。

runtime 装配 UC Package 时按顺序调用：注册函数/Gate → `defineWorkflow(contract)` →
`execute(pkg, input)` → 对 `wait_human/wait_input` 使用 `resume(runId, response)`。
查询接口为 `getRun/listRuns`。模拟数据只替代本次试验的物理回填，不省略任何合同、Gate 或验收步骤。

## 目录

```
packages/dsh-gate/            Gate 注册表插件
packages/dsh-uc-workflow/     确定性 UC 工作流引擎
  lib/compile.js              编译期 fail-closed 检查
  lib/engine.js               执行循环 + schema 校验 + Gate + resume
  lib/dsh-store.js            DSH storage-domain RunStore
  lib/index.js                cordis 插件入口（ctx.ucWorkflow）
instances/                    UC 实例（合同 + 纯函数 + fixtures）
examples/                     可直接运行的 E2E
tests/                        全量测试
docs/                         验收判据模板、移植报告
```

## 附录：dsh 底座钉版本

- deepseek-harness：v0.1.1-rc.2，commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（2026-08-21）
- fork：ai-native-world/deepseek-harness
- 许可：MIT
