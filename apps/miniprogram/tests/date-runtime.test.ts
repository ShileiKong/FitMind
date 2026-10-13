import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { platformStore } from './local-fixtures';

// Exercise a settled-promise adapter after async/await has been downlevelled.
// This is a compatibility stress test, not a claim about the phone's Promise.
class ImmediatePromise {
  private state = 0;
  private value: any;
  private listeners: Array<() => void> = [];
  constructor(executor: (resolve: any, reject: any) => void) {
    try {
      executor(
        (value: any) => this.resolve(value),
        (error: any) => this.finish(2, error),
      );
    } catch (error) {
      this.finish(2, error);
    }
  }
  private resolve(value: any) {
    if (value?.then)
      value.then(
        (v: any) => this.resolve(v),
        (e: any) => this.finish(2, e),
      );
    else this.finish(1, value);
  }
  private finish(state: number, value: any) {
    if (this.state) return;
    this.state = state;
    this.value = value;
    this.listeners.splice(0).forEach((run) => run());
  }
  then(success?: any, failure?: any): ImmediatePromise {
    return new ImmediatePromise((resolve, reject) => {
      const run = () => {
        try {
          const handler = this.state === 1 ? success : failure;
          if (handler) resolve(handler(this.value));
          else (this.state === 1 ? resolve : reject)(this.value);
        } catch (error) {
          reject(error);
        }
      };
      if (this.state) run();
      else this.listeners.push(run);
    });
  }
  catch(failure: any) {
    return this.then(undefined, failure);
  }
  finally(work: any) {
    return this.then(
      (value: any) => ImmediatePromise.resolve(work()).then(() => value),
      (error: any) =>
        ImmediatePromise.resolve(work()).then(() => {
          throw error;
        }),
    );
  }
  static resolve(value?: any) {
    return new ImmediatePromise((resolve) => resolve(value));
  }
  static all(values: any[]) {
    return new ImmediatePromise((resolve, reject) => {
      const result: any[] = [];
      let remaining = values.length;
      if (!remaining) resolve(result);
      values.forEach((value, i) =>
        ImmediatePromise.resolve(value).then((v: any) => {
          result[i] = v;
          if (!--remaining) resolve(result);
        }, reject),
      );
    });
  }
}

it.each([
  { name: 'native microtasks', runtime: Promise },
  { name: 'immediately settled callbacks', runtime: ImmediatePromise },
])(
  'loads a nonempty date and today snapshot with $name after async lowering',
  async ({ runtime }) => {
    const result = await build({
      stdin: {
        contents: `import { LocalClient } from './src/local/client';
        globalThis.client = new LocalClient(platform, () => new Date('2026-10-13T04:00:00Z'));`,
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      bundle: true,
      platform: 'neutral',
      format: 'cjs',
      target: 'es2015',
      write: false,
    });
    const context: any = {
      platform: platformStore(),
      Promise: runtime,
      Intl,
      TextEncoder,
    };
    runInNewContext(result.outputFiles[0].text, context);
    const client = context.client;
    expect(await client.time()).toMatchObject({
      local_date: '2026-10-13',
      timezone: 'Asia/Shanghai',
    });
    await client.refresh();
    expect(client.data.context.local_date).toBe('2026-10-13');
    expect(client.data.summary.local_date).toBe('2026-10-13');
    expect(client.data.capabilities.local).toBe(true);
    expect(client.data.records).toEqual([]);
  },
);
