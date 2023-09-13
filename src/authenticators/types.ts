// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';

export class AuthenticationNotSupportedError extends Error {
    constructor() {
        super('Authentication not supported');
    }
}

export interface IAuthenticator {
    dispose(): void;
    getJupyterAuthInfo(
        options: {
            baseUrl: string;
            authInfo: {
                username: string;
                password: string;
            };
        },
        token: CancellationToken
    ): Promise<{ headers?: Record<string, string>; token?: string } | undefined>;
    getHubApiAuthInfo?(
        options: {
            baseUrl: string;
            authInfo: {
                username: string;
                password: string;
            };
        },
        token: CancellationToken
    ): Promise<{ headers?: Record<string, string>; token?: string } | undefined>;
}
