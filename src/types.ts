// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// eslint-disable @typescript-eslint/no-explicit-any

import { CancellationToken, Event } from 'vscode';
import { IAuthenticator } from './authenticators/types';
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
            headers?: Record<string, string>;
            token?: string;
        },
        authenticator: IAuthenticator,
        token: CancellationToken
    ): Promise<void>;
}

export interface IJupyterHubApi {
    getVersion(): Promise<string>;
}
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
