// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, CancellationToken, Disposable } from 'vscode';

export async function sleep(timeout: number, token?: CancellationToken) {
    let disposables: Disposable[] = [];
    const promise = new Promise((resolve) => {
        const timer = setTimeout(resolve, timeout);
        disposables.push(new Disposable(() => clearTimeout(timer)));
    });
    await raceCancellation(token, promise).finally(() => {
        disposables.forEach((d) => d.dispose());
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPromise<T>(v: any): v is Promise<T> {
    return typeof v?.then === 'function' && typeof v?.catch === 'function';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPromiseLike<T>(v: any): v is PromiseLike<T> {
    return typeof v?.then === 'function';
}

export function raceTimeout<T>(timeout: number, ...promises: Promise<T>[]): Promise<T | undefined>;
export function raceTimeout<T>(timeout: number, defaultValue: T, ...promises: Promise<T>[]): Promise<T>;
export function raceTimeout<T>(timeout: number, defaultValue: T, ...promises: Promise<T>[]): Promise<T> {
    const resolveValue = isPromiseLike(defaultValue) ? undefined : defaultValue;
    if (isPromiseLike(defaultValue)) {
        promises.push(defaultValue as unknown as Promise<T>);
    }

    let promiseResolve: ((value: T) => void) | undefined = undefined;

    const timer = setTimeout(() => promiseResolve?.(resolveValue as unknown as T), timeout);

    return Promise.race([
        Promise.race(promises).finally(() => clearTimeout(timer)),
        new Promise<T>((resolve) => (promiseResolve = resolve))
    ]);
}

export function raceTimeoutError<T>(timeout: number, error: Error, ...promises: Promise<T>[]): Promise<T> {
    let promiseReject: ((value: unknown) => void) | undefined = undefined;
    const timer = setTimeout(() => promiseReject?.(error), timeout);

    return Promise.race([
        Promise.race(promises).finally(() => clearTimeout(timer)),
        new Promise<T>((_, reject) => (promiseReject = reject))
    ]);
}

export async function raceCancellation<T>(
    token: CancellationToken | undefined,
    ...promises: Promise<T>[]
): Promise<T | undefined>;
export async function raceCancellation<T>(
    token: CancellationToken | undefined,
    defaultValue: T,
    ...promises: Promise<T>[]
): Promise<T>;
export async function raceCancellation<T>(
    token: CancellationToken | undefined,
    defaultValue: T,
    ...promises: Promise<T>[]
): Promise<T | undefined> {
    let value: T | undefined;
    if (isPromiseLike(defaultValue)) {
        promises.push(defaultValue as unknown as Promise<T>);
        value = undefined;
    } else {
        value = defaultValue;
    }
    if (!token) {
        return await Promise.race(promises);
    }
    if (token.isCancellationRequested) {
        return value;
    }

    return new Promise((resolve, reject) => {
        if (token.isCancellationRequested) {
            return resolve(value);
        }
        const disposable = token.onCancellationRequested(() => {
            disposable.dispose();
            resolve(value);
        });
        Promise.race(promises)
            .then(resolve, reject)
            .finally(() => disposable.dispose());
    });
}
export async function raceCancellationError<T>(token?: CancellationToken, ...promises: Promise<T>[]): Promise<T> {
    if (!token) {
        return Promise.race(promises);
    }
    if (token.isCancellationRequested) {
        throw new CancellationError();
    }

    return new Promise((resolve, reject) => {
        if (token.isCancellationRequested) {
            return reject(new CancellationError());
        }
        const disposable = token.onCancellationRequested(() => {
            disposable.dispose();
            reject(new CancellationError());
        });
        Promise.race(promises)
            .then(resolve, reject)
            .finally(() => disposable.dispose());
    });
}

//======================
// Deferred

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolved: boolean;
    readonly rejected: boolean;
    readonly completed: boolean;
    readonly value?: T;
    resolve(value?: T | PromiseLike<T>): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reject(reason?: any): void;
}

class DeferredImpl<T> implements Deferred<T> {
    private _resolve!: (value: T | PromiseLike<T>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _reject!: (reason?: any) => void;
    private _resolved: boolean = false;
    private _rejected: boolean = false;
    private _promise: Promise<T>;
    private _value: T | undefined;
    public get value() {
        return this._value;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private scope: any = null) {
        // eslint-disable-next-line
        this._promise = new Promise<T>((res, rej) => {
            this._resolve = res;
            this._reject = rej;
        });
    }
    public resolve(value?: T | PromiseLike<T>) {
        this._value = value as T | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._resolve.apply(this.scope ? this.scope : this, arguments as any);
        this._resolved = true;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public reject(_reason?: any) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._reject.apply(this.scope ? this.scope : this, arguments as any);
        this._rejected = true;
    }
    get promise(): Promise<T> {
        return this._promise;
    }
    get resolved(): boolean {
        return this._resolved;
    }
    get rejected(): boolean {
        return this._rejected;
    }
    get completed(): boolean {
        return this._rejected || this._resolved;
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDeferred<T>(scope: any = null): Deferred<T> {
    return new DeferredImpl<T>(scope);
}

export function createDeferredFromPromise<T>(promise: Promise<T>): Deferred<T> {
    const deferred = createDeferred<T>();
    promise.then(deferred.resolve.bind(deferred)).catch(deferred.reject.bind(deferred));
    return deferred;
}
