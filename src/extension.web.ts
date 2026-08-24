// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExtensionContext, ExtensionMode, window } from 'vscode';
import { disposableStore } from './common/lifecycle';
import { JupyterHubUrlCapture } from './urlCapture';
import { JupyterHubUriHandler } from './uriHandler';
import { JupyterRequestCreator } from './common/requestCreator.web';
import { traceError } from './common/logging';
import { JupyterHubServerStorage } from './storage';
import { SimpleFetch } from './common/request';
import { JupyterServerIntegration } from './jupyterIntegration';
import { getJupyterApi, setIsWebExtension } from './utils';
import { ClassImplementationsForTests } from './testUtils';
import { trackInstallOfExtension } from './common/telemetry';

export async function activate(context: ExtensionContext) {
    trackInstallOfExtension();
    setIsWebExtension();
    context.subscriptions.push(disposableStore);
    // Register this synchronously, so that links opened while we're still activating are not lost.
    const uriHandler = disposableStore.add(new JupyterHubUriHandler());
    disposableStore.add(window.registerUriHandler(uriHandler));
    getJupyterApi()
        .then((api) => {
            const requestCreator = new JupyterRequestCreator();
            const fetch = new SimpleFetch(requestCreator);
            const storage = disposableStore.add(new JupyterHubServerStorage(context.secrets, context.globalState));
            const uriCapture = disposableStore.add(new JupyterHubUrlCapture(fetch, storage));
            const integration = disposableStore.add(
                new JupyterServerIntegration(fetch, api.exports, storage, uriCapture)
            );
            uriHandler.initialize({ fetch, storage, urlCapture: uriCapture, integration });
        })
        .catch((ex) => traceError('Failed to activate jupyter extension', ex));

    if (context.extensionMode === ExtensionMode.Test) {
        return { RequestCreator: JupyterRequestCreator } as ClassImplementationsForTests;
    }
}
