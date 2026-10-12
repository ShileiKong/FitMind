import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  return new DatabaseSync(path);
}
export function migrate(db: DatabaseSync) {
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,local_date TEXT,version INTEGER NOT NULL,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS entity_scope ON entities(user_id,kind,local_date);
CREATE TABLE IF NOT EXISTS revisions(id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(id,version));
CREATE TABLE IF NOT EXISTS operations(user_id TEXT NOT NULL,scope TEXT NOT NULL,op_key TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user_id,scope,op_key));
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,conversation_id TEXT NOT NULL,request TEXT NOT NULL,context TEXT NOT NULL,result TEXT,state TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS commands(message_id TEXT NOT NULL,action_slot INTEGER NOT NULL,payload TEXT NOT NULL,result TEXT,PRIMARY KEY(message_id,action_slot),FOREIGN KEY(message_id) REFERENCES messages(id));`);
}
export { DatabaseSync };
