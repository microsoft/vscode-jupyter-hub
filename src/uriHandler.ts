// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    ProgressLocation,
    Uri,
    UriHandler,
    window
} from 'vscode';
import { Localized } from './common/localize';
import { DisposableStore } from './common/lifecycle';
import { traceDebug, traceError } from './common/logging';
import { noop, uuid } from './common/utils';
import { sendJupyterHubUrlAdded, sendJupyterHubUrlNotAdded } from './common/telemetry';
import { SimpleFetch } from './common/request';
import { JupyterHubServerStorage } from './storage';
import { JupyterHubUrlCapture, getSuggestedDisplayName } from './urlCapture';
import { JupyterServerIntegration } from './jupyterIntegration';
import { Authenticator } from './authenticator';
import { JupyterHubConnectionValidator } from './validator';
import { extractTokenFromUrl, extractUserNameFromUrl, getJupyterHubBaseUrl, getVersion } from './jupyterHubApi';

const AddServerPath = 'add-server';

export type AddServerRequest = {
    url: string;
    username: string;
    token: string;
    displayName: string;
    serverName: string | undefined;
};

/**
 * Parses `vscode://ms-toolsai.jupyter-hub/add-server?url=...&username=...&token=...`.
 *
 * @returns Parsed parameters for valid `add-server` request, or `undefined` if the URI is not `add-server`
 * @throws If the URI is `add-server` but is invalid
 */
export function parseAddServerUri(uri: Uri): AddServerRequest | undefined {
    if (uri.path.replace(/^\/+|\/+$/g, '').toLowerCase() !== AddServerPath) {
        return;
    }
    const query = new URLSearchParams(uri.query);
    const url = (query.get('url') || '').trim();
    if (!url || !isHttpUrl(url)) {
        throw new Error(Localized.invalidUriToAddServer);
    }
    return {
        url,
        username: (query.get('username') || extractUserNameFromUrl(url) || '').trim(),
        token: (query.get('token') || extractTokenFromUrl(url) || '').trim(),
        displayName: (query.get('displayName') || '').trim(),
        serverName: query.get('serverName') || undefined
    };
}

function isHttpUrl(value: string) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol.toLowerCase());
    } catch (ex) {
        traceDebug(`Failed to parse URL ${value}`, ex);
        return false;
    }
}

async function addServerFromUri(
    request: AddServerRequest,
    fetch: SimpleFetch,
    storage: JupyterHubServerStorage,
    cancelToken: CancellationToken
): Promise<{ id: string; displayName: string }> {
    const baseUrl = await getJupyterHubBaseUrl(request.url, fetch, cancelToken);
    const hubVersion = await getVersion(baseUrl, fetch, cancelToken);
    const authenticator = new Authenticator(fetch);
    const authInfo = { username: request.username, password: '', token: request.token };
    const result = await authenticator.getJupyterAuthInfo({ baseUrl, authInfo }, cancelToken);
    await new JupyterHubConnectionValidator(fetch).validateJupyterUri(
        baseUrl,
        { ...authInfo, token: result.token },
        authenticator,
        cancelToken
    );

    const displayName =
        request.displayName ||
        getSuggestedDisplayName(
            baseUrl,
            request.serverName,
            storage.all.map((s) => s.displayName)
        );
    const id = uuid();
    await storage.addServerOrUpdate(
        { id, baseUrl, displayName, serverName: request.serverName },
        { username: request.username, password: '', token: result.token, tokenId: result.tokenId || '' }
    );
    sendJupyterHubUrlAdded(baseUrl, hubVersion, id);
    return { id, displayName };
}

/**
 * Handles `vscode://ms-toolsai.jupyter-hub/...` URIs.
 *
 * Implements a queue of pending URIs that are received before the extension is fully activated.
 */
export class JupyterHubUriHandler extends DisposableStore implements UriHandler {
    private services?: {
        fetch: SimpleFetch;
        storage: JupyterHubServerStorage;
        urlCapture: JupyterHubUrlCapture;
        integration: JupyterServerIntegration;
    };
    private readonly pendingUris: Uri[] = [];

    public initialize(services: {
        fetch: SimpleFetch;
        storage: JupyterHubServerStorage;
        urlCapture: JupyterHubUrlCapture;
        integration: JupyterServerIntegration;
    }) {
        this.services = services;
        const pending = this.pendingUris.splice(0, this.pendingUris.length);
        pending.forEach((uri) => this.handleUri(uri).then(noop, noop));
    }

    public async handleUri(uri: Uri): Promise<void> {
        if (!this.services) {
            traceDebug(`Queuing Uri ${uri.toString(true)} until the extension is fully activated`);
            this.pendingUris.push(uri);
            return;
        }
        const { fetch, storage, urlCapture, integration } = this.services;
        let request: AddServerRequest | undefined;
        try {
            request = parseAddServerUri(uri);
        } catch (ex) {
            traceError(`Invalid Uri ${uri.toString(true)}`, ex);
            window.showErrorMessage(Localized.invalidUriToAddServer).then(noop, noop);
            return;
        }
        if (!request) {
            traceError(`Unsupported Uri ${uri.toString(true)}`);
            window.showErrorMessage(Localized.invalidUriToAddServer).then(noop, noop);
            return;
        }

        if (!request.username || !request.token) {
            const tokenSource = this.add(new CancellationTokenSource());
            try {
                const server = await urlCapture.captureRemoteJupyterUrl(
                    tokenSource.token,
                    request.url,
                    request.displayName
                );
                if (server) {
                    integration.notifyServersChanged();
                }
            } catch (ex) {
                if (!(ex instanceof CancellationError)) {
                    traceError(`Failed to add JupyterHub server ${request.url}`, ex);
                }
            }
            return;
        }

        // The Uri carries a token, so nothing else would be displayed to the user.
        // Confirm, as any web page can trigger such a link.
        const yes = Localized.addServerFromUriConfirmYes;
        const selection = await window.showInformationMessage(
            Localized.addServerFromUriConfirm(request.url),
            { modal: true, detail: Localized.addServerFromUriConfirmDetail },
            yes
        );
        if (selection !== yes) {
            sendJupyterHubUrlNotAdded('cancel', '');
            return;
        }

        await window.withProgress(
            { location: ProgressLocation.Notification, title: Localized.ConnectingToJupyterServer, cancellable: true },
            async (_progress, cancelToken) => {
                try {
                    const { displayName } = await addServerFromUri(request!, fetch, storage, cancelToken);
                    integration.notifyServersChanged();
                    window.showInformationMessage(Localized.addServerFromUriSuccess(displayName)).then(noop, noop);
                } catch (ex) {
                    if (ex instanceof CancellationError) {
                        sendJupyterHubUrlNotAdded('cancel', '');
                        return;
                    }
                    traceError(`Failed to add JupyterHub server ${request!.url}`, ex);
                    sendJupyterHubUrlNotAdded('error', '');
                    window.showErrorMessage(Localized.addServerFromUriFailure(request!.url)).then(noop, noop);
                }
            }
        );
    }
}
