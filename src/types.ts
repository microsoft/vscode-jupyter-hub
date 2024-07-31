// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// eslint-disable @typescript-eslint/no-explicit-any

import { CancellationToken, Event } from 'vscode';
import { ClassType } from './common/types';

export interface IJupyterRequestCreator {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getRequestCtor(getAuthHeader?: () => any): ClassType<Request>;
    getFetchMethod(): (input: RequestInfo, init?: RequestInit) => Promise<Response>;
    getHeadersCtor(): ClassType<Headers>;
    getRequestInit(): RequestInit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createHttpRequestAgent?(): any;
}

export type JupyterHubServer = {
    id: string;
    baseUrl: string;
    displayName: string;
    /**
     * Name of the server to start and use.
     * If empty, then defaults to the `default` server, which is an empty string.
     */
    serverName?: string;
};

export interface IJupyterHubServerStorage {
    onDidRemove: Event<JupyterHubServer>;
    all: JupyterHubServer[];
    dispose(): void;
    getCredentials(serverId: string): Promise<{ username: string; password: string } | undefined>;
    addServerOrUpdate(server: JupyterHubServer, auth: { username: string; password: string }): Promise<void>;
    removeServer(serverId: string): Promise<void>;
}

export interface IJupyterHubConnectionValidator {
    validateJupyterUri(
        baseUrl: string,
        authInfo: {
            username: string;
            password: string;
            token?: string;
        },
        authenticator: IAuthenticator,
        token: CancellationToken
    ): Promise<void>;
    ensureServerIsRunning(
        baseUrl: string,
        serverName: string | undefined,
        authInfo: {
            username: string;
            password: string;
            token?: string;
        },
        authenticator: IAuthenticator,
        token: CancellationToken
    ): Promise<void>;
}

export interface IAuthenticator {
    getJupyterAuthInfo(
        options: {
            baseUrl: string;
            authInfo: {
                username: string;
                password: string;
                token: string;
            };
        },
        token: CancellationToken
    ): Promise<{ token: string; tokenId?: string }>;
}
