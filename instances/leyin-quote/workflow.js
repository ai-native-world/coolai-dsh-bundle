/**
 * 乐饮报价 UC · 五步确定性工作流合同（POC 第一个实例）。
 * 需求解析(model) → 成本归集(function) → 产能推演(function) → 报价决策(function+Gate) → 产出报价单(function)。
 * 本文件是"实例数据"，不含任何乐饮硬编码以外的业务配置——引擎插件保持通用。
 * @module instances/leyin-quote/workflow
 */

export const contract = {
  id: 'leyin-dual-quote',
  name: '乐饮双份报价',
  inputSchema: {
    type: 'object',
    properties: {
      inquiry: { type: 'string', description: '客户询价原文（模型解析）' },
      today: { type: 'string', description: '基准日 YYYY-MM-DD（确定性：交期计算以此为锚）' },
      materialUnitPrice: { type: 'number', description: '物料单价（元/单位，模拟数据）' },
      machiningRate: { type: 'number', description: '机台加工费率（元/单位，模拟数据）' },
      marginTarget: { type: 'number', description: '目标毛利率' },
      marginFloor: { type: 'number', description: '毛利率底线（Gate 阈值）' },
      lineCapacityDaily: { type: 'integer', description: '产线日产能（单位/天）' },
      scheduledLoad: { type: 'number', description: '已排产负荷（单位）' },
    },
    required: ['inquiry', 'today', 'materialUnitPrice', 'machiningRate', 'marginTarget', 'marginFloor', 'lineCapacityDaily', 'scheduledLoad'],
  },
  steps: [
    {
      id: 'parse',
      name: '需求解析',
      executor: { kind: 'model' },
      input: { inquiry: '$input.inquiry' },
      outputKey: 'parse',
      outputSchema: {
        type: 'object',
        properties: {
          product: { type: 'string' },
          quantity: { type: 'integer' },
          color: { type: 'string' },
          coating: { type: 'string' },
          bean: { type: 'string' },
          dueDate: { type: 'string' },
        },
        required: ['product', 'quantity', 'color', 'coating', 'bean', 'dueDate'],
      },
      transitions: { PASS: 'cost', FAIL: '$fail', NEEDS_INPUT: '$wait_input' },
    },
    {
      id: 'cost',
      name: '成本归集',
      executor: { kind: 'function', ref: 'leyin:cost' },
      input: {
        quantity: '$steps.parse.quantity',
        materialUnitPrice: '$input.materialUnitPrice',
        machiningRate: '$input.machiningRate',
      },
      outputKey: 'cost',
      outputSchema: {
        type: 'object',
        properties: {
          materialCost: { type: 'number' },
          machiningCost: { type: 'number' },
          totalCost: { type: 'number' },
        },
        required: ['materialCost', 'machiningCost', 'totalCost'],
      },
      transitions: { PASS: 'capacity', FAIL: '$fail' },
    },
    {
      id: 'capacity',
      name: '产能推演',
      executor: { kind: 'function', ref: 'leyin:capacity' },
      input: {
        quantity: '$steps.parse.quantity',
        dueDate: '$steps.parse.dueDate',
        today: '$input.today',
        lineCapacityDaily: '$input.lineCapacityDaily',
        scheduledLoad: '$input.scheduledLoad',
      },
      outputKey: 'capacity',
      outputSchema: {
        type: 'object',
        properties: {
          estDays: { type: 'integer' },
          dueDays: { type: 'integer' },
          loadAfter: { type: 'number' },
          feasible: { type: 'boolean' },
        },
        required: ['estDays', 'dueDays', 'loadAfter', 'feasible'],
      },
      transitions: { PASS: 'decision', FAIL: '$fail' },
    },
    {
      id: 'decision',
      name: '报价决策',
      executor: { kind: 'function', ref: 'leyin:decision' },
      input: {
        totalCost: '$steps.cost.totalCost',
        quantity: '$steps.parse.quantity',
        marginTarget: '$input.marginTarget',
        marginFloor: '$input.marginFloor',
      },
      outputKey: 'decision',
      outputSchema: {
        type: 'object',
        properties: {
          unitPrice: { type: 'number' },
          margin: { type: 'number' },
          marginOk: { type: 'boolean' },
        },
        required: ['unitPrice', 'margin', 'marginOk'],
      },
      postGates: ['gate-margin-floor'],
      transitions: { PASS: 'quote', FAIL_GATE: '$wait_human', FAIL: '$fail' },
    },
    {
      id: 'quote',
      name: '产出报价单',
      executor: { kind: 'function', ref: 'leyin:quote' },
      input: {
        product: '$steps.parse.product',
        quantity: '$steps.parse.quantity',
        dueDate: '$steps.parse.dueDate',
        unitPrice: '$steps.decision.unitPrice',
      },
      outputKey: 'quote',
      outputSchema: {
        type: 'object',
        properties: { doc: { type: 'object', properties: { quoteId: { type: 'string' } } } },
        required: ['doc'],
      },
      transitions: { PASS: '$success', FAIL: '$fail' },
    },
  ],
  outputSchema: {
    type: 'object',
    properties: { quote: { type: 'object', properties: { quoteId: { type: 'string' } } } },
    required: ['quote'],
  },
  outputMapping: { quote: '$steps.quote.doc' },
}
