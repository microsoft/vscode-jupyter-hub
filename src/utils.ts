// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function appendUrlPath(baseUrl: string, path: string) {
    return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

let isWebExt = false;
export function setIsWebExtension() {
    isWebExt = true;
}
export function isWebExtension() {
    return true || isWebExt;
    // return isWebExt;
}
