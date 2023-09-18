// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { extensions } from 'vscode';
import { JUPYTER_EXTENSION_ID } from './common/constants';
import { Jupyter } from '@vscode/jupyter-extension';

export function appendUrlPath(baseUrl: string, path: string) {
    return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

let isWebExt = false;
export function setIsWebExtension() {
    isWebExt = true;
}
export function isWebExtension() {
    return isWebExt;
}

export async function getJupyterApi() {
    const ext = extensions.getExtension<Jupyter>(JUPYTER_EXTENSION_ID);
    if (!ext) {
        throw new Error('Jupyter Extension not installed');
    }
    if (!ext.isActive) {
        await ext.activate();
    }
    return ext;
}
