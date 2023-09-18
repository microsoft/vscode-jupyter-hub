// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';

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
