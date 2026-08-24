# coolai-dsh-bundle

酷爱 bundle —— deepseek-harness（dsh）生态的确定性 UC 工作流插件集。

DSH 底座 POC 产物（2026-08-24）：把"确定性 UC 工作流合同"做成 dsh 的 cordis 插件，
模板固定步骤、实例注入 I/O、编译 fail-closed、运行全程留痕、数值步骤纯函数化。

## 插件

| 包 | 作用 | 服务 |
|---|---|---|
| `packages/dsh-gate` | Gate 注册表（register/run），供 UC 工作流挂前置/步骤/链路/输出检查 | `ctx.ucGates` |
| `packages/dsh-uc-workflow` | 确定性 UC 工作流引擎：编译 fail-closed、function/model/human 三类 executor、声明式 Gate、transitions、事件流、human 挂起恢复 | `ctx.ucWorkflow` |

## 实例（UC 是数据，不是代码）

| 实例 | 域 | 状态 |
|---|---|---|
| `instances/leyin-quote` | 乐饮报价五步（需求解析→成本归集→产能推演→报价决策→产出报价单） | 15 项测试全绿 |
| `instances/formula-reference` | 配方方案确定七步（UC-RD-001，曹天航 v0.2 样本移植） | 9/9 用例通过 |

## 测试

```bash
node --test tests/
```

31 项：compile fail-closed 反例 10 + 乐饮纯函数 6 + 乐饮链路 5 + formula 9 + 其他。

## 挂载到 dsh

```bash
# 依赖 dsh 仓库（版本钉死在 README 附录）
pnpm dsh plugin --profile headless add "file:<本仓>/packages/dsh-gate"
pnpm dsh plugin --profile headless add "file:<本仓>/packages/dsh-uc-workflow"
pnpm dsh --profile headless --dump-config   # 可见 coolai-gate / coolai-uc-workflow 两行
```

插件 = cordis 插件（export name/inject/apply）；bundle 声明在 package.json
`dsh.bundle.patch` → cordis.patch.yml。

## 目录

```
packages/dsh-gate/            Gate 注册表插件
packages/dsh-uc-workflow/     确定性 UC 工作流引擎
  lib/compile.js              编译期 fail-closed 检查
  lib/engine.js               执行循环 + schema 校验 + Gate + resume
  lib/index.js                cordis 插件入口（ctx.ucWorkflow）
instances/                    UC 实例（合同 + 纯函数 + fixtures）
tests/                        全量测试
docs/                         验收判据模板、移植报告
```

## 附录：dsh 底座钉版本

- deepseek-harness：v0.1.1-rc.2，commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（2026-08-21）
- fork：ai-native-world/deepseek-harness
- 许可：MIT
