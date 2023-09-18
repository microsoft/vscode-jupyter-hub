// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { SimpleFetch } from '../common/request';
import { IAuthenticator } from './types';
import { generateNewApiToken, verifyApiToken } from '../jupyterHubApi';

export class NewAuthenticator implements IAuthenticator {
    constructor(private readonly fetch: SimpleFetch) {}
    public async getJupyterAuthInfo(
        options: {
            baseUrl: string;
            authInfo: {
                username: string;
                password: string;
                token: string;
            };
        },
        token: CancellationToken
    ): Promise<{ token: string; tokenId: string }> {
        // Possible user has entered the API token instead of the password.
        if (!options.authInfo.token) {
            const isApiTokenValid = await verifyApiToken(
                options.baseUrl,
                options.authInfo.username,
                options.authInfo.password,
                this.fetch,
                token
            );
            if (isApiTokenValid) {
                return { tokenId: '', token: options.authInfo.password };
            }
        }
        if (options.authInfo.token) {
            const isApiTokenValid = await verifyApiToken(
                options.baseUrl,
                options.authInfo.username,
                options.authInfo.token,
                this.fetch,
                token
            );
            if (isApiTokenValid) {
                return { tokenId: '', token: options.authInfo.token };
            }
        }
        return generateNewApiToken(
            options.baseUrl,
            options.authInfo.username,
            options.authInfo.password,
            this.fetch,
            token
        );
    }
}
