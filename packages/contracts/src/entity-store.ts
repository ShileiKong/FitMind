import type { CommandContext } from './common.js';

/** The synchronous persistence boundary shared by SQLite and phone-local services. */
export interface EntityStore {
  transaction<T>(fn: () => T): T;
  get<T = any>(user: string, kind: string, id: string): T;
  list<T = any>(user: string, kind: string): T[];
  put<T extends { id: string; version: number }>(
    user: string,
    kind: string,
    value: T,
  ): T;
  mutate<T>(
    ctx: CommandContext,
    scope: string,
    payload: unknown,
    fn: () => T,
  ): T;
  journal(
    ctx: CommandContext & { journal?: CommandJournal },
    result: unknown,
  ): void;
  id(): string;
}
export interface CommandJournal {
  message_id: string;
  slot: number;
  payload: string;
}
