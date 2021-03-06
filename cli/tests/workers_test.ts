// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

// Requires to be run with `--allow-net` flag

// FIXME(bartlomieju): this file is an integration test only because
// workers are leaking ops at the moment - `worker.terminate()` is not
// yet implemented. Once it gets implemented this file should be
// again moved to `cli/js/` as an unit test file.

import { assert, assertEquals } from "../../std/testing/asserts.ts";

export interface ResolvableMethods<T> {
  resolve: (value?: T | PromiseLike<T>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reject: (reason?: any) => void;
}

export type Resolvable<T> = Promise<T> & ResolvableMethods<T>;

export function createResolvable<T>(): Resolvable<T> {
  let methods: ResolvableMethods<T>;
  const promise = new Promise<T>((resolve, reject): void => {
    methods = { resolve, reject };
  });
  // TypeScript doesn't know that the Promise callback occurs synchronously
  // therefore use of not null assertion (`!`)
  return Object.assign(promise, methods!) as Resolvable<T>;
}

Deno.test({
  name: "worker terminate",
  fn: async function (): Promise<void> {
    const promise = createResolvable();

    const jsWorker = new Worker("../tests/subdir/test_worker.js", {
      type: "module",
      name: "jsWorker",
    });
    const tsWorker = new Worker("../tests/subdir/test_worker.ts", {
      type: "module",
      name: "tsWorker",
    });

    tsWorker.onmessage = (e): void => {
      assertEquals(e.data, "Hello World");
      promise.resolve();
    };

    jsWorker.onmessage = (e): void => {
      assertEquals(e.data, "Hello World");
      tsWorker.postMessage("Hello World");
    };

    jsWorker.onerror = (e: Event): void => {
      e.preventDefault();
      jsWorker.postMessage("Hello World");
    };

    jsWorker.postMessage("Hello World");
    await promise;
    tsWorker.terminate();
    jsWorker.terminate();
  },
});

Deno.test({
  name: "worker nested",
  fn: async function (): Promise<void> {
    const promise = createResolvable();

    const nestedWorker = new Worker("../tests/subdir/nested_worker.js", {
      type: "module",
      name: "nested",
    });

    nestedWorker.onmessage = (e): void => {
      assert(e.data.type !== "error");
      promise.resolve();
    };

    nestedWorker.postMessage("Hello World");
    await promise;
    nestedWorker.terminate();
  },
});

Deno.test({
  name: "worker throws when executing",
  fn: async function (): Promise<void> {
    const promise = createResolvable();
    const throwingWorker = new Worker("../tests/subdir/throwing_worker.js", {
      type: "module",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throwingWorker.onerror = (e: any): void => {
      e.preventDefault();
      assert(/Uncaught Error: Thrown error/.test(e.message));
      promise.resolve();
    };

    await promise;
    throwingWorker.terminate();
  },
});

Deno.test({
  name: "worker fetch API",
  fn: async function (): Promise<void> {
    const promise = createResolvable();

    const fetchingWorker = new Worker("../tests/subdir/fetching_worker.js", {
      type: "module",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchingWorker.onerror = (e: any): void => {
      e.preventDefault();
      promise.reject(e.message);
    };

    // Defer promise.resolve() to allow worker to shut down
    fetchingWorker.onmessage = (e): void => {
      assert(e.data === "Done!");
      promise.resolve();
    };

    await promise;
    fetchingWorker.terminate();
  },
});

Deno.test({
  name: "worker terminate busy loop",
  fn: async function (): Promise<void> {
    const promise = createResolvable();

    const busyWorker = new Worker("../tests/subdir/busy_worker.js", {
      type: "module",
    });

    let testResult = 0;

    busyWorker.onmessage = (e): void => {
      testResult = e.data;
      if (testResult >= 10000) {
        busyWorker.terminate();
        busyWorker.onmessage = (_e): void => {
          throw new Error("unreachable");
        };
        setTimeout(() => {
          assertEquals(testResult, 10000);
          promise.resolve();
        }, 100);
      }
    };

    busyWorker.postMessage("ping");
    await promise;
  },
});

Deno.test({
  name: "worker race condition",
  fn: async function (): Promise<void> {
    // See issue for details
    // https://github.com/denoland/deno/issues/4080
    const promise = createResolvable();

    const racyWorker = new Worker("../tests/subdir/racy_worker.js", {
      type: "module",
    });

    racyWorker.onmessage = (e): void => {
      assertEquals(e.data.buf.length, 999999);
      racyWorker.onmessage = (_e): void => {
        throw new Error("unreachable");
      };
      setTimeout(() => {
        promise.resolve();
      }, 100);
    };

    await promise;
  },
});
