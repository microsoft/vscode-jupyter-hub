// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { extensions } from 'vscode';
import { JUPYTER_EXTENSION_ID } from './common/constants';
import { Jupyter } from '@vscode/jupyter-extension';

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
