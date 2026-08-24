/**
 * 乐饮报价 UC · 五步确定性工作流 v0.2（durable 引擎版）。
 * parse(model) → cost(function) → capacity(function) → decision(function) → quote(function)
 * Gate 拦截（毛利低于底线 / 交期不可行）转 review(human) 人拍板：
 * approve → quote；reject → $fail（驳回即新 Run，引用旧 Run 证据）。
 * @module instances/leyin-quote/workflow
 */

const T = {
  PASS: next => ({ PASS: next, FAIL: '$fail', NEEDS_INPUT: '$wait_input', HUMAN_REQUIRED: '$wait_human' }),
}

export const contract = {
  id: 'leyin-dual-quote',
  version: '0.2.0',
  input_gates: [],
  output_gates: ['gate-output-quote'],
  inputSchema: {
    type: 'object',
    properties: {
      inquiry: { type: 'string', minLength: 1, description: '客户询价原文（模型解析）' },
      today: { type: 'string', minLength: 1, description: '基准日 YYYY-MM-DD（确定性锚点）' },
      materialUnitPrice: { type: 'number', minimum: 0, description: '物料单价（元/单位，模拟数据）' },
      machiningRate: { type: 'number', minimum: 0, description: '机台加工费率（元/单位，模拟数据）' },
      marginTarget: { type: 'number', description: '目标毛利率' },
      marginFloor: { type: 'number', description: '毛利率底线（Gate 阈值）' },
      lineCapacityDaily: { type: 'integer', exclusiveMinimum: 0, description: '产线日产能（单位/天）' },
      scheduledLoad: { type: 'number', minimum: 0, description: '已排产负荷（单位）' },
    },
    required: ['inquiry', 'today', 'materialUnitPrice', 'machiningRate', 'marginTarget', 'marginFloor', 'lineCapacityDaily', 'scheduledLoad'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      quote: {
        type: 'object',
        required: ['quoteId', 'product', 'quantity', 'unitPrice', 'totalPrice', 'dueDate', 'terms', 'knowhowRef'],
        properties: {
          quoteId: { type: 'string', minLength: 1 },
          product: { type: 'string', minLength: 1 },
          quantity: { type: 'integer', exclusiveMinimum: 0 },
          unitPrice: { type: 'number' },
          totalPrice: { type: 'number' },
          dueDate: { type: 'string', minLength: 1 },
          terms: { type: 'string', minLength: 1 },
          knowhowRef: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    required: ['quote'],
    additionalProperties: false,
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
        required: ['product', 'quantity', 'color', 'coating', 'bean', 'dueDate'],
        properties: {
          product: { type: 'string', minLength: 1 },
          quantity: { type: 'integer', exclusiveMinimum: 0 },
          color: { type: 'string', minLength: 1 },
          coating: { type: 'string', minLength: 1 },
          bean: { type: 'string', minLength: 1 },
          dueDate: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
      preGates: ['gate-inquiry'],
      postGates: [],
      transitions: T.PASS('cost'),
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
        required: ['materialCost', 'machiningCost', 'totalCost'],
        properties: {
          materialCost: { type: 'number' },
          machiningCost: { type: 'number' },
          totalCost: { type: 'number' },
        },
        additionalProperties: false,
      },
      preGates: [],
      postGates: [],
      transitions: T.PASS('capacity'),
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
        required: ['estDays', 'dueDays', 'loadAfter', 'feasible'],
        properties: {
          estDays: { type: 'integer' },
          dueDays: { type: 'integer' },
          loadAfter: { type: 'number' },
          feasible: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      preGates: [],
      postGates: ['gate-feasible'],
      transitions: { PASS: 'decision', HUMAN_REQUIRED: 'review', FAIL: '$fail', NEEDS_INPUT: '$wait_input' },
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
        required: ['unitPrice', 'margin', 'marginOk'],
        properties: {
          unitPrice: { type: 'number' },
          margin: { type: 'number' },
          marginOk: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      preGates: [],
      postGates: ['gate-margin-floor'],
      transitions: { PASS: 'quote', HUMAN_REQUIRED: 'review', FAIL: '$fail', NEEDS_INPUT: '$wait_input' },
    },
    {
      id: 'review',
      name: '人拍板（超边界承诺）',
      executor: { kind: 'human', ref: 'human://quote-owner-decision' },
      input: {
        draft: '$steps.decision',
        requirement: '$steps.parse',
      },
      outputKey: 'review',
      outputSchema: {
        type: 'object',
        required: ['decision', 'rationale'],
        properties: {
          decision: { enum: ['approve', 'reject'] },
          rationale: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
      preGates: [],
      postGates: ['gate-review-valid'],
      transitionPath: '$output.decision',
      transitions: { approve: 'quote', reject: '$fail', FAIL: '$fail' },
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
        required: ['doc'],
        properties: { doc: { type: 'object' } },
        additionalProperties: false,
      },
      preGates: [],
      postGates: [],
      transitions: { PASS: '$success', FAIL: '$fail' },
    },
  ],
  outputMapping: { quote: '$steps.quote.doc' },
}
