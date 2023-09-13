// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtensionContext } from 'vscode';
import { disposableStore } from './common/lifecycle';
import { JupyterHubUrlCapture } from './urlCapture';
import { JupyterRequestCreator } from './common/requestCreator.web';
import { getJupyterApi } from './jupyterApi';
import { traceError } from './common/logging';
import { JupyterHubServerStorage } from './storage';
import { SimpleFetch } from './common/request';
import { JupyterServerIntegration } from './jupyterIntegration';
import { CookieStore } from './common/cookieStore.web';

export async function activate(context: ExtensionContext) {
    context.subscriptions.push(disposableStore);
    getJupyterApi()
        .then((api) => {
            const requestCreator = new JupyterRequestCreator();
            const fetch = new SimpleFetch(requestCreator);
            const storage = disposableStore.add(new JupyterHubServerStorage(context.secrets, context.globalState));
            const uriCapture = disposableStore.add(new JupyterHubUrlCapture(fetch, false, storage, CookieStore));
            disposableStore.add(new JupyterServerIntegration(fetch, api.exports, storage, uriCapture, CookieStore));
        })
        .catch((ex) => traceError('Failed to activate jupyter extension', ex));
}
