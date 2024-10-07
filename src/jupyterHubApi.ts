// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, workspace } from 'vscode';
import { SimpleFetch } from './common/request';
import { ServerConnection } from '@jupyterlab/services';
import { traceDebug, traceError, traceWarn } from './common/logging';
import { appendUrlPath } from './utils';
import { noop } from './common/utils';
import { trackUsageOfOldApiGeneration } from './common/telemetry';

export namespace ApiTypes {
    /**
     * https://jupyterhub.readthedocs.io/en/stable/reference/rest-api.html#operation/get-user
     */
    export interface UserInfo {
        /**
         * The user's notebook server's base URL, if running; null if not.
         */
        server?: string;
        last_activity: Date;
        roles: string[];
        groups: string[];
        name: string;
        admin: boolean;
        pending?: null | 'spawn' | 'stop';
        /**
         * The servers for this user. By default: only includes active servers.
         * Changed in 3.0: if ?include_stopped_servers parameter is specified, stopped servers will be included as well.
         */
        servers?: Record<string, ServerInfo>;
    }
    export interface ServerInfo {
        /**
         * The server's name.
         * The user's default server has an empty name
         */
        name: string;
        /**
         * UTC timestamp last-seen activity on this server.
         */
        last_activity: Date;
        /**
         * UTC timestamp when the server was last started.
         */
        started?: Date;
        /**
         * The currently pending action, if any.
         * A server is not ready if an action is pending.
         */
        pending?: null | 'spawn' | 'stop';
        /**
         * Whether the server is ready for traffic.
         * Will always be false when any transition is pending.
         */
        ready: boolean;
        /**
         * Whether the server is stopped.
         * Added in JupyterHub 3.0,
         * and only useful when using the ?include_stopped_servers request parameter.
         * Now that stopped servers may be included (since JupyterHub 3.0),
         * this is the simplest way to select stopped servers.
         * Always equivalent to not (ready or pending).
         */
        stopped: boolean;
        /**
         * The URL path where the server can be accessed (typically /user/:name/:server.name/).
         * Will be a full URL if subdomains are configured.
         */
        url: string;
        /**
         * User specified options for the user's spawned instance of a single-user server.
         */
        user_options: {};
        /**
         * The URL path for an event-stream to retrieve events during a spawn.
         */
        progress_url: string;
    }
}

export async function getVersion(url: string, fetch: SimpleFetch, token: CancellationToken): Promise<string> {
    // Otherwise request hub/api. This should return the json with the hub version
    // if this is a hub url
    const apiUrl = appendUrlPath(url, 'hub/api');
    let response: Response | undefined;
    let messageTemplate = `Invalid Jupyter Hub Url ${apiUrl} (failed to get version)`;
    try {
        const response = await fetch.send(
            apiUrl,
            {
                method: 'get',
                redirect: 'manual',
                headers: { Connection: 'keep-alive' }
            },
            token
        );
        if (response.status === 200) {
            messageTemplate = `Invalid Jupyter Hub Url ${apiUrl} (failed to parse response)`;
            const { version }: { version: string } = await response.json();
            return version;
        }
        throw new Error('Non 200 response');
    } catch (ex) {
        throw new Error(await getResponseErrorMessageToThrowOrLog(messageTemplate, response));
    }
}

export async function deleteApiToken(
    baseUrl: string,
    username: string,
    tokenId: string,
    token: string,
    fetch: SimpleFetch,
    cancellationToken: CancellationToken
) {
    const url = appendUrlPath(baseUrl, `hub/api/users/${username}/tokens/${tokenId}`);
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
    let response: Response | undefined;
    try {
        const url = appendUrlPath(baseUrl, `hub/api/users/${username}/tokens`);
        const body = {
            auth: { username: username, password: password },
            note: `Requested by JupyterHub extension in VSCode`
        };
        type ResponseType = { user: string; id: string; token: string };
        response = await fetch.send(url, { method: 'POST', body: JSON.stringify(body) }, cancellationToken);
        const json = (await response.json()) as ResponseType;
        traceDebug(`Generated new token for user using the new way`);
        return { token: json.token, tokenId: json.id };
    } catch (ex) {
        traceError(await getResponseErrorMessageToThrowOrLog(`Failed to generate token, trying old way`, response), ex);
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
            traceDebug(`Generated new token for user using the old way`);
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
    cancellationToken: CancellationToken,
    includeStoppedServers?: boolean
): Promise<ApiTypes.UserInfo> {
    traceDebug(`Getting user info for user ${baseUrl}, token length = ${token.length} && ${token.trim().length}`);
    const path = includeStoppedServers
        ? `hub/api/users/${username}?include_stopped_servers`
        : `hub/api/users/${username}`;
    const url = appendUrlPath(baseUrl, path);
    const headers = { Authorization: `token ${token}` };
    const response = await fetch.send(url, { method: 'GET', headers }, cancellationToken);
    if (response.status === 200) {
        const json = await response.json();
        traceDebug(`Got user info for user ${baseUrl} = ${JSON.stringify(json)}`);
        return json;
    }
    throw new Error(await getResponseErrorMessageToThrowOrLog(`Failed to get user info`, response));
}

export async function getUserJupyterUrl(
    baseUrl: string,
    username: string,
    serverName: string | undefined,
    token: string,
    fetch: SimpleFetch,
    cancelToken: CancellationToken
) {
    // If we have a server name, then also get a list of the stopped servers.
    // Possible the server has been stopped.
    const includeStoppedServers = !!serverName;
    const info = await getUserInfo(baseUrl, username, token, fetch, cancelToken, includeStoppedServers);
    if (serverName) {
        // Find the server in the list
        const server = (info.servers || {})[serverName];
        if (server?.url) {
            return appendUrlPath(baseUrl, server.url);
        }
        const servers = Object.keys(info.servers || {});
        traceError(
            `Failed to get the user Jupyter Url for ${serverName} existing servers include ${JSON.stringify(info)}`
        );
        throw new Error(
            `Named Jupyter Server '${serverName}' not found, existing servers include ${servers.join(', ')}`
        );
    } else {
        const defaultServer = (info.servers || {})['']?.url || info.server;
        if (defaultServer) {
            return appendUrlPath(baseUrl, defaultServer);
        }
        traceError(
            `Failed to get the user Jupyter Url as there is no default server for the user ${JSON.stringify(info)}`
        );
        return appendUrlPath(baseUrl, `user/${username}/`);
    }
}

export async function listServers(
    baseUrl: string,
    username: string,
    token: string,
    fetch: SimpleFetch,
    cancelToken: CancellationToken
) {
    try {
        const info = await getUserInfo(baseUrl, username, token, fetch, cancelToken, true).catch((ex) => {
            traceWarn(`Failed to get user info with stopped servers, defaulting without`, ex);
            return getUserInfo(baseUrl, username, token, fetch, cancelToken);
        });

        return Object.values(info.servers || {});
    } catch (ex) {
        traceError(`Failed to get a list of servers for the user ${username}`, ex);
        return [];
    }
}

export async function startServer(
    baseUrl: string,
    username: string,
    serverName: string | undefined,
    token: string,
    fetch: SimpleFetch,
    cancellationToken: CancellationToken
): Promise<void> {
    const url = serverName
        ? appendUrlPath(baseUrl, `hub/api/users/${username}/servers/${encodeURIComponent(serverName)}`)
        : appendUrlPath(baseUrl, `hub/api/users/${username}/server`);
    const headers = { Authorization: `token ${token}` };
    const response = await fetch.send(url, { method: 'POST', headers }, cancellationToken);
    if (response.status === 201 || response.status === 202) {
        return;
    }
    throw new Error(await getResponseErrorMessageToThrowOrLog(`Failed to fetch user info`, response));
}
async function getResponseErrorMessageToThrowOrLog(message: string, response?: Response) {
    if (!response) {
        return message;
    }
    let responseText = '';
    try {
        responseText = await response.text();
    } catch (ex) {
        traceError(`Error fetching text from response to log error ${message}`, ex);
    }
    return `${message}, ${response.statusText} (${response.status}) with message  ${responseText}`;
}

export async function createServerConnectSettings(
    baseUrl: string,
    serverName: string | undefined,
    authInfo: {
        username: string;
        token: string;
    },
    fetch: SimpleFetch,
    cancelToken: CancellationToken
): Promise<ServerConnection.ISettings> {
    baseUrl = await getUserJupyterUrl(baseUrl, authInfo.username, serverName, authInfo.token, fetch, cancelToken);
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
export function extractTokenFromUrl(url: string) {
    try {
        const parsedUrl = new URL(url);
        const token = parsedUrl.searchParams.get('token');
        return token || '';
    } catch {
        return '';
    }
}
