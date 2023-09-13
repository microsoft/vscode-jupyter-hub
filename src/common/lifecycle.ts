// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface IDisposable {
    dispose(): void;
}

function isIterable<T = any>(thing: any): thing is Iterable<T> {
    return thing && typeof thing === 'object' && typeof thing[Symbol.iterator] === 'function';
}

/**
 * Disposes of the value(s) passed in.
 */
export function dispose<T extends IDisposable>(disposable: T): T;
export function dispose<T extends IDisposable>(disposable: T | undefined): T | undefined;
export function dispose<T extends IDisposable>(disposables: Array<T>): Array<T>;
export function dispose<T extends IDisposable>(disposables: ReadonlyArray<T>): ReadonlyArray<T>;
export function dispose<T extends IDisposable>(arg: T | Array<T> | ReadonlyArray<T> | undefined): any {
    if (isIterable(arg)) {
        for (const d of arg) {
            if (d) {
                try {
                    d.dispose();
                } catch {
                    //
                }
            }
        }
    } else if (arg) {
        try {
            arg.dispose();
        } catch {
            //
        }
    }
}

export class DisposableStore {
    private readonly disposables: IDisposable[] = [];
    add<T extends IDisposable>(disposable: T) {
        this.disposables.push(disposable);
        return disposable;
    }
    dispose() {
        dispose(this.disposables);
    }
}

export const disposableStore = new DisposableStore();
