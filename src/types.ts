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

export type JupyterHubAuthKind = 'password' | 'token' | 'tmpauth';

export type JupyterHubAuthInfo = {
    authKind: JupyterHubAuthKind;
    username: string;
    password: string;
    token: string;
    tokenId: string;
};

export type JupyterHubResolvedAuthInfo = Pick<JupyterHubAuthInfo, 'authKind' | 'username' | 'token' | 'tokenId'>;

export interface ITmpAuthenticatorBootstrapper {
    tryBootstrapJupyterHubAuth(
        baseUrl: string,
        token: CancellationToken
    ): Promise<JupyterHubResolvedAuthInfo | undefined>;
}

export class JupyterHubMissingUsernameError extends Error {
    constructor() {
        super('Username is required when using password-based JupyterHub authentication.');
        this.name = 'JupyterHubMissingUsernameError';
    }
}

export interface IJupyterHubServerStorage {
    onDidRemove: Event<JupyterHubServer>;
    all: JupyterHubServer[];
    dispose(): void;
    getCredentials(serverId: string): Promise<JupyterHubAuthInfo | undefined>;
    addServerOrUpdate(server: JupyterHubServer, auth: JupyterHubAuthInfo): Promise<void>;
    removeServer(serverId: string): Promise<void>;
}

export interface IJupyterHubConnectionValidator {
    validateJupyterUri(
        baseUrl: string,
        authInfo: JupyterHubAuthInfo,
        authenticator: IAuthenticator,
        token: CancellationToken
    ): Promise<void>;
    ensureServerIsRunning(
        baseUrl: string,
        serverName: string | undefined,
        authInfo: JupyterHubAuthInfo,
        authenticator: IAuthenticator,
        token: CancellationToken
    ): Promise<void>;
}

export interface IAuthenticator {
    getJupyterAuthInfo(
        options: {
            baseUrl: string;
            authInfo: JupyterHubAuthInfo;
        },
        token: CancellationToken
    ): Promise<JupyterHubResolvedAuthInfo>;
}
