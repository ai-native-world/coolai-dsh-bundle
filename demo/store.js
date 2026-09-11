/**
 * 临时壳 · 真持久化 RunStore（用 Node 内置 node:sqlite，零新增依赖）。
 * 引擎只要求 store 具备 create/save/load/list，因此这里直接咬合到 SQLite。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function createSqliteRunStore(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS uc_runs (
      run_id TEXT PRIMARY KEY,
      record TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_uc_runs_updated ON uc_runs (updated_at DESC);
  `)
  const get = db.prepare('SELECT record FROM uc_runs WHERE run_id = ?')
  const put = db.prepare(`INSERT INTO uc_runs (run_id, record, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at`)
  const all = db.prepare('SELECT record FROM uc_runs ORDER BY updated_at DESC')
  return {
    async create(record) {
      if (get.get(record.runId)) throw new Error(`run ${record.runId} 已存在`)
      put.run(record.runId, JSON.stringify(record), Date.now())
    },
    async save(record) {
      if (!get.get(record.runId)) throw new Error(`run ${record.runId} 不存在`)
      put.run(record.runId, JSON.stringify(record), Date.now())
    },
    async load(runId) {
      const row = get.get(runId)
      return row ? JSON.parse(row.record) : undefined
    },
    async list() {
      return all.all().map(r => JSON.parse(r.record))
    },
    close() { db.close() },
  }
}
