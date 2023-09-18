// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtensionContext, ExtensionMode } from 'vscode';
import { disposableStore } from './common/lifecycle';
import { JupyterHubUrlCapture } from './urlCapture';
import { JupyterRequestCreator } from './common/requestCreator.node';
import { traceError } from './common/logging';
import { JupyterHubServerStorage } from './storage';
import { SimpleFetch } from './common/request';
import { JupyterServerIntegration } from './jupyterIntegration';
import { ClassImplementationsForTests } from './testUtils';
import { getJupyterApi } from './utils';
import { trackInstallOfExtension } from './common/telemetry';

export async function activate(context: ExtensionContext) {
    trackInstallOfExtension();
    context.subscriptions.push(disposableStore);
    getJupyterApi()
        .then((api) => {
            const requestCreator = new JupyterRequestCreator();
            const fetch = new SimpleFetch(requestCreator);
            const storage = disposableStore.add(new JupyterHubServerStorage(context.secrets, context.globalState));
            const uriCapture = disposableStore.add(new JupyterHubUrlCapture(fetch, storage));
            disposableStore.add(new JupyterServerIntegration(fetch, api.exports, storage, uriCapture));
        })
        .catch((ex) => traceError('Failed to activate jupyter extension', ex));
    if (context.extensionMode === ExtensionMode.Test) {
        return { RequestCreator: JupyterRequestCreator } as ClassImplementationsForTests;
    }
}
