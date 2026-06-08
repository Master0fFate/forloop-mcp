import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { TaskEvent } from "../orchestrator/schemas.js";

let sqlPromise: Promise<SqlJsStatic> | undefined;

async function getSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs();
  return sqlPromise;
}

export class SQLiteStateStore {
  private constructor(
    private readonly db: Database,
    public readonly dbPath: string
  ) {}

  static async open(dbPath: string): Promise<SQLiteStateStore> {
    mkdirSync(dirname(dbPath), { recursive: true });
    const SQL = await getSql();
    const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
    const store = new SQLiteStateStore(db, dbPath);
    store.migrate();
    store.persist();
    return store;
  }

  append(taskId: string, type: string, payload: unknown): TaskEvent {
    const event: TaskEvent = {
      id: randomUUID(),
      taskId,
      timestamp: new Date().toISOString(),
      type,
      payload
    };

    this.db.run(
      "insert into task_events (id, task_id, timestamp, type, payload_json) values (?, ?, ?, ?, ?)",
      [event.id, event.taskId, event.timestamp, event.type, JSON.stringify(event.payload)]
    );
    this.persist();
    return event;
  }

  list(taskId: string): TaskEvent[] {
    const stmt = this.db.prepare(
      "select id, task_id, timestamp, type, payload_json from task_events where task_id = ? order by rowid asc"
    );
    const events: TaskEvent[] = [];
    try {
      stmt.bind([taskId]);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        events.push({
          id: String(row.id),
          taskId: String(row.task_id),
          timestamp: String(row.timestamp),
          type: String(row.type),
          payload: JSON.parse(String(row.payload_json))
        });
      }
    } finally {
      stmt.free();
    }
    return events;
  }

  listTaskIds(): string[] {
    const result = this.db.exec("select distinct task_id from task_events order by task_id asc");
    if (result.length === 0) {
      return [];
    }
    return result[0]?.values.map((row: unknown[]) => String(row[0])) ?? [];
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  private migrate(): void {
    this.db.run(`
      create table if not exists task_events (
        id text primary key,
        task_id text not null,
        timestamp text not null,
        type text not null,
        payload_json text not null
      );
      create index if not exists idx_task_events_task_id on task_events(task_id);
    `);
  }

  private persist(): void {
    writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }
}
