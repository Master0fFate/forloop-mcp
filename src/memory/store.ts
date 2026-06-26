import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { SessionIdentity } from "../orchestrator/session.js";

let sqlPromise: Promise<SqlJsStatic> | undefined;

async function getSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs();
  return sqlPromise;
}

export interface MemoryRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly sessionStorageName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly content: string;
  readonly tags: string[];
  readonly source?: string;
  readonly metadata: Record<string, unknown>;
}

export interface RememberMemoryInput {
  readonly content: string;
  readonly tags?: readonly string[];
  readonly source?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  readonly query?: string;
  readonly tag?: string;
  readonly limit?: number;
}

export interface MemoryQueryResult {
  readonly records: MemoryRecord[];
  readonly total: number;
  readonly sessionStorageName: string;
  readonly dbPath: string;
}

export interface SessionMemoryStoreOptions {
  readonly workspace: string;
  readonly session: SessionIdentity;
  readonly dbPath?: string;
}

export function memoryDbPathForSession(workspace: string, session: SessionIdentity, dbPath?: string): string {
  if (dbPath) {
    return resolve(dirname(resolve(dbPath)), "sessions", session.storageName, "memory.sqlite");
  }
  return resolve(workspace, ".forloop", "sessions", session.storageName, "memory.sqlite");
}

export class SessionMemoryStore {
  private constructor(
    private readonly db: Database,
    private readonly session: SessionIdentity,
    public readonly dbPath: string
  ) {}

  static async open(options: SessionMemoryStoreOptions): Promise<SessionMemoryStore> {
    const dbPath = memoryDbPathForSession(options.workspace, options.session, options.dbPath);
    mkdirSync(dirname(dbPath), { recursive: true });
    const SQL = await getSql();
    const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
    const store = new SessionMemoryStore(db, options.session, dbPath);
    store.migrate();
    store.persist();
    return store;
  }

  remember(input: RememberMemoryInput): MemoryRecord {
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: randomUUID(),
      sessionId: this.session.id,
      sessionStorageName: this.session.storageName,
      createdAt: now,
      updatedAt: now,
      content: input.content,
      tags: normalizeTags(input.tags),
      source: input.source,
      metadata: input.metadata ?? {}
    };

    this.db.run(
      `insert into memories
        (id, session_id, session_storage_name, created_at, updated_at, content, tags_json, source, metadata_json)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.sessionId,
        record.sessionStorageName,
        record.createdAt,
        record.updatedAt,
        record.content,
        JSON.stringify(record.tags),
        record.source ?? null,
        JSON.stringify(record.metadata)
      ]
    );
    this.persist();
    return record;
  }

  list(query: MemoryQuery = {}): MemoryQueryResult {
    const records = this.records(query.limit);
    return this.result(filterByTag(records, query.tag), query.limit);
  }

  search(query: MemoryQuery = {}): MemoryQueryResult {
    const normalizedQuery = query.query?.trim().toLowerCase();
    const records = filterByTag(this.records(query.limit), query.tag).filter((record) => {
      if (!normalizedQuery) {
        return true;
      }
      return [record.content, record.source ?? "", record.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
    return this.result(records, query.limit);
  }

  delete(id: string): boolean {
    const before = this.count();
    this.db.run("delete from memories where id = ?", [id]);
    this.persist();
    return this.count() < before;
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  private records(limit = 50): MemoryRecord[] {
    const stmt = this.db.prepare(
      `select id, session_id, session_storage_name, created_at, updated_at, content, tags_json, source, metadata_json
       from memories
       order by datetime(created_at) desc, rowid desc
       limit ?`
    );
    const records: MemoryRecord[] = [];
    try {
      stmt.bind([Math.max(1, Math.min(limit, 500))]);
      while (stmt.step()) {
        records.push(rowToRecord(stmt.getAsObject() as Record<string, unknown>));
      }
    } finally {
      stmt.free();
    }
    return records;
  }

  private result(records: MemoryRecord[], limit = 50): MemoryQueryResult {
    const limited = records.slice(0, Math.max(1, Math.min(limit, 500)));
    return {
      records: limited,
      total: records.length,
      sessionStorageName: this.session.storageName,
      dbPath: this.dbPath
    };
  }

  private count(): number {
    const result = this.db.exec("select count(*) from memories");
    const value = result[0]?.values[0]?.[0];
    return typeof value === "number" ? value : Number(value ?? 0);
  }

  private migrate(): void {
    this.db.run(`
      create table if not exists memories (
        id text primary key,
        session_id text not null,
        session_storage_name text not null,
        created_at text not null,
        updated_at text not null,
        content text not null,
        tags_json text not null,
        source text,
        metadata_json text not null
      );
      create index if not exists idx_memories_created_at on memories(created_at);
      create index if not exists idx_memories_session_storage_name on memories(session_storage_name);
    `);
  }

  private persist(): void {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function filterByTag(records: readonly MemoryRecord[], tag: string | undefined): MemoryRecord[] {
  const normalizedTag = tag?.trim();
  if (!normalizedTag) {
    return [...records];
  }
  return records.filter((record) => record.tags.includes(normalizedTag));
}

function rowToRecord(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    sessionStorageName: String(row.session_storage_name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    content: String(row.content),
    tags: parseStringArray(row.tags_json),
    source: row.source === null || row.source === undefined ? undefined : String(row.source),
    metadata: parseMetadata(row.metadata_json)
  };
}

function parseStringArray(value: unknown): string[] {
  const parsed = JSON.parse(String(value));
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseMetadata(value: unknown): Record<string, unknown> {
  const parsed = JSON.parse(String(value));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}
