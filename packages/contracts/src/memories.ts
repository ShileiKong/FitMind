import { Type, type Static } from './common.js';
export const MemoryInputSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 100 }),
    value: Type.String({ minLength: 1, maxLength: 2000 }),
    source_message_id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type MemoryInput = Static<typeof MemoryInputSchema>;
export type Memory = MemoryInput & {
  id: string;
  version: number;
  deleted_at: string | null;
  source_ids: string[];
  updated_at: string;
};
