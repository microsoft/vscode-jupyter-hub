// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClassType<T> = { new (...args: any[]): T };

/**
 * Like `Readonly<>`, but recursive.
 *
 * See https://github.com/Microsoft/TypeScript/pull/21316.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeepReadonly<T> = T extends any[] ? IDeepReadonlyArray<T[number]> : DeepReadonlyNonArray<T>;
type DeepReadonlyNonArray<T> = T extends object ? DeepReadonlyObject<T> : T;
interface IDeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> {}
type DeepReadonlyObject<T> = {
    readonly [P in NonFunctionPropertyNames<T>]: DeepReadonly<T[P]>;
};
type NonFunctionPropertyNames<T> = { [K in keyof T]: T[K] extends Function ? never : K }[keyof T];

/**
 * Converts a union type to intersection
 * Courtesy of https://stackoverflow.com/questions/50374908/transform-union-type-to-intersection-type
 *
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
export type PickType<T, Value> = {
    [P in keyof T as T[P] extends Value ? P : never]: T[P];
};
export type ExcludeType<T, Value> = {
    [P in keyof T as T[P] extends Value ? never : P]: T[P];
};

export type ReadWrite<T> = {
    -readonly [P in keyof T]: T[P];
};
