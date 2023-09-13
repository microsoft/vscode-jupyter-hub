// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, workspace } from 'vscode';
import { SimpleFetch } from './common/request';
import { IJupyterRequestCreator, ApiTypes } from './types';
import { ServerConnection } from '@jupyterlab/services';
import { traceError } from './common/logging';
import { appendUrlPath } from './utils';
import { noop } from './common/utils';

export class JupyterHubApi {
    constructor(
        private readonly baseUrl: string,
        private readonly auth: {
            username: string;
            headers?: Record<string, string>;
            token?: string;
        },
        private readonly fetch: SimpleFetch
    ) {}
    private async getErrorMessageToThrow(message: string, response: Response) {
        let responseText = '';
        try {
            responseText = await response.text();
        } catch (ex) {
            traceError(`Error fetching text from response ${ex} to log error ${message}`);
        }
        return `${message}, ${response.statusText} (${response.status}) with message  ${responseText}`;
    }
    private get(url: string, token: CancellationToken): Promise<Response> {
        return this.fetch.send(
            appendUrlPath(this.baseUrl, url),
            {
                method: 'get',
                headers: { Connection: 'keep-alive', ...(this.auth.headers || {}) }
            },
            token
        );
    }
    private post(url: string, body: string | undefined, token: CancellationToken): Promise<Response> {
        return this.fetch.send(
            appendUrlPath(this.baseUrl, url),
            {
                method: 'post',
                headers: { Connection: 'keep-alive', ...(this.auth.headers || {}) },
                body
            },
            token
        );
    }
    public async getVersion(): Promise<string> {
        return '1.0.0';
    }
    public hasServerStarted(): Promise<boolean> {
        return Promise.resolve(true);
    }
    public async getUserInfo(token: CancellationToken): Promise<ApiTypes.UserInfo> {
        const response = await this.get('user', token);
        if (response.status === 200) {
            return response.json();
        }
        throw new Error(await this.getErrorMessageToThrow(`Failed to fetch user info`, response));
    }
    public async startServer(token: CancellationToken): Promise<void> {
        const response = await this.post(`users/${this.auth.username}/server`, undefined, token);
        if (response.status === 201 || response.status === 202) {
            return;
        }
        throw new Error(await this.getErrorMessageToThrow(`Failed to fetch user info`, response));
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

export function createServerConnectSettings(
    baseUrl: string,
    authInfo: {
        username: string;
        headers?: Record<string, string>;
        token?: string;
    },
    requestCreator: IJupyterRequestCreator
): ServerConnection.ISettings {
    baseUrl = getJupyterUrl(baseUrl, authInfo.username);
    let serverSettings: Partial<ServerConnection.ISettings> = {
        baseUrl,
        appUrl: '',
        // A web socket is required to allow token authentication
        wsUrl: baseUrl.replace('http', 'ws')
    };
    const authHeader =
        authInfo.headers && Object.keys(authInfo?.headers ?? {}).length > 0 ? authInfo.headers : undefined;

    // Agent is allowed to be set on this object, but ts doesn't like it on RequestInit, so any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let requestInit: any = requestCreator.getRequestInit();

    const isTokenEmpty = authInfo.token === '' || authInfo.token === 'null';
    if (!isTokenEmpty || authHeader) {
        serverSettings = { ...serverSettings, token: authInfo.token || '', appendToken: true };
    }

    const allowUnauthorized = workspace
        .getConfiguration('jupyter')
        .get<boolean>('allowUnauthorizedRemoteConnection', false);
    // If this is an https connection and we want to allow unauthorized connections set that option on our agent
    // we don't need to save the agent as the previous behaviour is just to create a temporary default agent when not specified
    if (baseUrl.startsWith('https') && allowUnauthorized && requestCreator.createHttpRequestAgent) {
        const requestAgent = requestCreator.createHttpRequestAgent();
        requestInit = { ...requestInit, agent: requestAgent };
    }

    // This replaces the WebSocket constructor in jupyter lab services with our own implementation
    // See _createSocket here:
    // https://github.com/jupyterlab/jupyterlab/blob/cfc8ebda95e882b4ed2eefd54863bb8cdb0ab763/packages/services/src/kernel/default.ts
    serverSettings = {
        ...serverSettings,
        init: requestInit,
        fetch: requestCreator.getFetchMethod(),
        Request: requestCreator.getRequestCtor(authHeader ? () => authHeader : undefined),
        Headers: requestCreator.getHeadersCtor()
    };

    return ServerConnection.makeSettings(serverSettings);
}

export function getJupyterUrl(baseUrl: string, username: string) {
    return appendUrlPath(baseUrl, `user/${username}/`);
}
export function getHubApiUrl(baseUrl: string) {
    return appendUrlPath(baseUrl, `hub/api`);
}
export function getJupyterLogoutUrl(baseUrl: string, username: string) {
    return appendUrlPath(baseUrl, `user/${username}/logout`);
}
export function getHubLogoutUrl(baseUrl: string) {
    return appendUrlPath(baseUrl, `hub/logout`);
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
