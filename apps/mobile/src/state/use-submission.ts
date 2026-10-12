import { useRef } from 'react';
import { randomUUID } from 'expo-crypto';
import { useApp } from './app';
import { SubmissionIntent } from './submission-intent';
export function useSubmission() {
  const a = useApp();
  const ref = useRef<SubmissionIntent | null>(null);
  ref.current ??= new SubmissionIntent(randomUUID);
  const intent = ref.current;
  return {
    get key() {
      return intent.key;
    },
    complete: () => intent.complete(),
    mutate: async (
      path: string,
      body: any,
      method = 'POST',
      _key?: string,
      attachments: any[] = [],
    ) => {
      try {
        return await intent.run(a.mutate, path, body, method, attachments);
      } catch (e: any) {
        if (e.retryable === false && intent.key) {
          await a.removePending(intent.key);
          intent.complete();
        }
        throw e;
      }
    },
  };
}
