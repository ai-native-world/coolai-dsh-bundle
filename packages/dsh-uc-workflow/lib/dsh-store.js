/** DSH storage-domain 适配器：把 UC Run 检查点保存到 Harness 原生持久层。 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const jsonObject = z.record(z.string(), z.unknown())
const runRecordSchema = z.object({
  runId: z.string().min(1),
  workflowId: z.string().min(1),
  workflowVersion: z.string().min(1),
  input: jsonObject,
  cursor: z.string().min(1),
  steps: jsonObject,
  events: z.array(jsonObject),
  status: z.enum(['running', 'wait_human', 'wait_input', 'done', 'failed']),
  pending: z.union([jsonObject, z.null()]),
  output: jsonObject.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict()

export const ucRunDomainSpec = defineDomain({
  name: 'coolai_uc_runs',
  version: 1,
  tables: { runs: domainTable(runRecordSchema) },
})

export async function createDshRunStore(storageDomain) {
  const domain = await storageDomain.open(ucRunDomainSpec)
  const table = domain.table('runs')
  return {
    store: {
      async create(record) {
        if (table.get(record.runId) !== undefined) throw new Error(`run ${record.runId} 已存在`)
        await table.put(record.runId, structuredClone(record))
      },
      async save(record) {
        if (table.get(record.runId) === undefined) throw new Error(`run ${record.runId} 不存在`)
        await table.put(record.runId, structuredClone(record))
      },
      async load(runId) {
        const record = table.get(runId)
        return record === undefined ? undefined : structuredClone(record)
      },
      async list() { return [...table.entries()].map(([, record]) => structuredClone(record)) },
    },
    close: () => domain.close(),
  }
}
