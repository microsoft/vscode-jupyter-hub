// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { extensions } from 'vscode';
import { EXTENSION_ID } from '../../common/constants';
import { ClassImplementationsForTests } from '../../testUtils';

export async function activateHubExtension() {
    const ext = extensions.getExtension(EXTENSION_ID);
    if (!ext) {
        throw new Error('JupyterHub extension not installed');
    }
    await ext.activate();
    return Promise.resolve(ext.exports as ClassImplementationsForTests);
}
