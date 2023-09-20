// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, workspace } from 'vscode';
import { SimpleFetch } from './common/request';
import { ServerConnection } from '@jupyterlab/services';
import { traceDebug, traceError } from './common/logging';
import { appendUrlPath } from './utils';
import { noop } from './common/utils';
import { trackUsageOfOldApiGeneration } from './common/telemetry';

export namespace ApiTypes {
    export interface UserInfo {
        server: string;
        last_activity: Date;
        roles: string[];
        groups: string[];
        name: string;
        admin: boolean;
        pending: null | 'spawn';
        servers: Record<
            string,
            {
                name: string;
                last_activity: Date;
                started: Date;
                pending: null | 'spawn';
                ready: boolean;
                stopped: boolean;
                url: string;
                user_options: {};
                progress_url: string;
            }
        >;
        session_id: string;
        scopes: string[];
    }
}

export async function getVersion(url: string, fetch: SimpleFetch, token: CancellationToken): Promise<string> {
    // Otherwise request hub/api. This should return the json with the hub version
    // if this is a hub url
    const response = await fetch.send(
        appendUrlPath(url, 'hub/api'),
        {
            method: 'get',
            redirect: 'manual',
            headers: { Connection: 'keep-alive' }
        },
        token
    );
    if (response.status === 200) {
        const { version }: { version: string } = await response.json();
        return version;
    }
    throw new Error(`Invalid Jupyter Hub Url ${url} (failed to get version).`);
}

export async function deleteApiToken(
    baseUrl: string,
    username: string,
    tokenId: string,
    token: string,
    fetch: SimpleFetch,
    cancellationToken: CancellationToken
) {
    const url = appendUrlPath(
        baseUrl,
        `hub/api/users/${encodeURIComponent(username)}/tokens/${encodeURIComponent(tokenId)}`
    );
    const options = { method: 'DELETE', headers: { Authorization: `token ${token}` } };
    await fetch.send(url, options, cancellationToken);
}

export async function verifyApiToken(
    baseUrl: string,
    username: string,
    token: string,
    fetch: SimpleFetch,
    cancellationToken: CancellationToken
) {
    try {
        await getUserInfo(baseUrl, username, token, fetch, cancellationToken);
        return true;
    } catch (ex) {
        // Capture errors, with CORS we can get an error here even if the token is valid.
        traceDebug(`Token is no longer valid`, ex);
        return false;
    }
}

export async function generateNewApiToken(
    baseUrl: string,
    username: string,
    password: string,
    fetch: SimpleFetch,
    cancellationToken: CancellationToken
): Promise<{ token: string; tokenId: string }> {
    try {
        const url = appendUrlPath(baseUrl, `hub/api/users/${encodeURIComponent(username)}/tokens`);
        const body = {
            auth: { username: username, password: password },
            note: `Requested by JupyterHub extension in VSCode`
        };
        type ResponseType = { user: string; id: string; token: string };
        const response = await fetch.send(url, { method: 'POST', body: JSON.stringify(body) }, cancellationToken);
        const json = (await response.json()) as ResponseType;
        return { token: json.token, tokenId: json.id };
    } catch (ex) {
        traceError(`Failed to generate token, trying old way`, ex);
        return generateNewApiTokenOldWay(baseUrl, username, password, fetch, cancellationToken);
    }
}

/**
 * This is a backup way of generating tokens.
 * In 1.5 the new approach was introduced, but we need to support older versions.
 * This in case we have users with older versions.
 */
export async function generateNewApiTokenOldWay(
    baseUrl: string,
    username: string,
    password: string,
    fetch: SimpleFetch,
    cancellationToken: CancellationToken
): Promise<{ token: string; tokenId: string }> {
    try {
        const url = appendUrlPath(baseUrl, `hub/api/authorizations/token`);
        const body = { username: username, password: password };
        type ResponseType = { user: {}; token: string };
        const response = await fetch.send(url, { method: 'POST', body: JSON.stringify(body) }, cancellationToken);
        const json = (await response.json()) as ResponseType;
        if (json.token) {
            trackUsageOfOldApiGeneration(baseUrl);
            return { token: json.token, tokenId: '' };
        }
        throw new Error('Unable to generate Token using the old api route');
    } catch (ex) {
        traceError(`Failed to generate token, trying old way`, ex);
        throw ex;
    }
}
export async function getUserInfo(
    baseUrl: string,
    username: string,
    token: string,
    fetch: SimpleFetch,
    cancellationToken: CancellationToken
): Promise<ApiTypes.UserInfo> {
    const url = appendUrlPath(baseUrl, `hub/api/users/${encodeURIComponent(username)}`);
    const headers = { Authorization: `token ${token}` };
    const response = await fetch.send(url, { method: 'GET', headers }, cancellationToken);
    if (response.status === 200) {
        return response.json();
    }
    throw new Error(await getResponseErrorMessageToThrow(`Failed to get user info`, response));
}

export async function getUserJupyterUrl(
    baseUrl: string,
    username: string,
    token: string,
    fetch: SimpleFetch,
    cancelToken: CancellationToken
) {
    let usersJupyterUrl = await getUserInfo(baseUrl, username, token, fetch, cancelToken)
        .then((info) => appendUrlPath(baseUrl, info.server))
        .catch((ex) => {
            traceError(`Failed to get the user Jupyter Url`, ex);
        });
    if (!usersJupyterUrl) {
        usersJupyterUrl = appendUrlPath(baseUrl, `user/${encodeURIComponent(username)}/`);
    }
    return usersJupyterUrl;
}

export async function startServer(
    baseUrl: string,
    username: string,
    token: string,
    fetch: SimpleFetch,
    cancellationToken: CancellationToken
): Promise<void> {
    const url = appendUrlPath(baseUrl, `hub/api/users/${encodeURIComponent(username)}/server`);
    const headers = { Authorization: `token ${token}` };
    const response = await fetch.send(url, { method: 'POST', headers }, cancellationToken);
    if (response.status === 201 || response.status === 202) {
        return;
    }
    throw new Error(await getResponseErrorMessageToThrow(`Failed to fetch user info`, response));
}
async function getResponseErrorMessageToThrow(message: string, response: Response) {
    let responseText = '';
    try {
        responseText = await response.text();
    } catch (ex) {
        traceError(`Error fetching text from response ${ex} to log error ${message}`);
    }
    return `${message}, ${response.statusText} (${response.status}) with message  ${responseText}`;
}

export async function createServerConnectSettings(
    baseUrl: string,
    authInfo: {
        username: string;
        token: string;
    },
    fetch: SimpleFetch,
    cancelToken: CancellationToken
): Promise<ServerConnection.ISettings> {
    baseUrl = await getUserJupyterUrl(baseUrl, authInfo.username, authInfo.token, fetch, cancelToken);
    let serverSettings: Partial<ServerConnection.ISettings> = {
        baseUrl,
        appUrl: '',
        // A web socket is required to allow token authentication
        wsUrl: baseUrl.replace('http', 'ws')
    };

    // Agent is allowed to be set on this object, but ts doesn't like it on RequestInit, so any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let requestInit: any = fetch.requestCreator.getRequestInit();

    serverSettings = { ...serverSettings, token: authInfo.token, appendToken: true };

    const allowUnauthorized = workspace
        .getConfiguration('jupyter')
        .get<boolean>('allowUnauthorizedRemoteConnection', false);
    // If this is an https connection and we want to allow unauthorized connections set that option on our agent
    // we don't need to save the agent as the previous behaviour is just to create a temporary default agent when not specified
    if (baseUrl.startsWith('https') && allowUnauthorized && fetch.requestCreator.createHttpRequestAgent) {
        const requestAgent = fetch.requestCreator.createHttpRequestAgent();
        requestInit = { ...requestInit, agent: requestAgent };
    }

    // This replaces the WebSocket constructor in jupyter lab services with our own implementation
    // See _createSocket here:
    // https://github.com/jupyterlab/jupyterlab/blob/cfc8ebda95e882b4ed2eefd54863bb8cdb0ab763/packages/services/src/kernel/default.ts
    serverSettings = {
        ...serverSettings,
        init: requestInit,
        fetch: fetch.requestCreator.getFetchMethod(),
        Request: fetch.requestCreator.getRequestCtor(undefined),
        Headers: fetch.requestCreator.getHeadersCtor()
    };

    return ServerConnection.makeSettings(serverSettings);
}

// Caching is faster than making a http request every single time.
const cacheOfBaseUrls = new Map<string, string>();

/**
 * Give a Url to a Jupyter Hub server, return the base url of the server.
 * If the Url is not a Jupyter Hub server, then an error is throw.
 */
export async function getJupyterHubBaseUrl(url: string, fetch: SimpleFetch, token: CancellationToken): Promise<string> {
    const cachedBaseUrl = cacheOfBaseUrls.get(url);
    if (cachedBaseUrl) {
        return cachedBaseUrl;
    }
    // We need to get the base url of the Jupyter Hub server.
    // User may have entered https://<host>/user/<username>/lab, we have no idea.

    // If the URL has the /user/ option in it, it's likely this is jupyter hub
    if (await getVersion(url, fetch, token).catch(noop)) {
        cacheOfBaseUrls.set(url, url);
        return url;
    }

    if (url.toLowerCase().includes('/user/')) {
        try {
            const strippedUrl = url.substring(0, url.toLowerCase().indexOf('/user/'));
            if (await getVersion(strippedUrl, fetch, token).catch(noop)) {
                cacheOfBaseUrls.set(url, strippedUrl);
                return strippedUrl;
            }
        } catch {
            //
        }
    }

    if (await getVersion(new URL(url).origin, fetch, token).catch(noop)) {
        cacheOfBaseUrls.set(url, new URL(url).origin);
        return new URL(url).origin;
    }

    throw new Error('Unable to determine base url of Jupyter Hub Server');
}

export function extractUserNameFromUrl(url: string) {
    // User user name from the Url.
    if (url.toLowerCase().includes('/user/')) {
        const parts = url.split('/');
        const userIndex = parts.findIndex((p) => p.toLowerCase() === 'user');
        if (userIndex > 0 && parts.length >= userIndex + 1) {
            return parts[userIndex + 1].trim();
        }
    }
}
