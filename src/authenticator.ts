// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { SimpleFetch } from './common/request';
import {
    IAuthenticator,
    ITmpAuthenticatorBootstrapper,
    JupyterHubAuthInfo,
    JupyterHubMissingUsernameError,
    JupyterHubResolvedAuthInfo
} from './types';
import { generateNewApiToken, getCurrentUser } from './jupyterHubApi';

function getAuthKind(authInfo: JupyterHubAuthInfo) {
    if (authInfo.authKind) {
        return authInfo.authKind;
    }
    if (authInfo.password) {
        return 'password' as const;
    }
    if (authInfo.token) {
        return 'token' as const;
    }
    return 'password' as const;
}

export class Authenticator implements IAuthenticator {
    constructor(
        private readonly fetch: SimpleFetch,
        private readonly tmpAuthBootstrapper?: ITmpAuthenticatorBootstrapper
    ) {}
    public async getJupyterAuthInfo(
        options: {
            baseUrl: string;
            authInfo: JupyterHubAuthInfo;
        },
        token: CancellationToken
    ): Promise<JupyterHubResolvedAuthInfo> {
        const authKind = getAuthKind(options.authInfo);
        if (authKind === 'tmpauth' && this.tmpAuthBootstrapper) {
            if (options.authInfo.token) {
                const currentUser = await getCurrentUser(
                    options.baseUrl,
                    options.authInfo.token,
                    this.fetch,
                    token
                ).catch(() => undefined);
                if (currentUser?.name) {
                    return {
                        authKind: 'tmpauth',
                        username: currentUser.name,
                        token: options.authInfo.token,
                        tokenId: options.authInfo.tokenId || ''
                    };
                }
            }
            const bootstrappedAuth = await this.tmpAuthBootstrapper.tryBootstrapJupyterHubAuth(options.baseUrl, token);
            if (bootstrappedAuth) {
                return bootstrappedAuth;
            }
        }
        if (options.authInfo.token) {
            const currentUser = await getCurrentUser(options.baseUrl, options.authInfo.token, this.fetch, token).catch(
                () => undefined
            );
            if (currentUser?.name) {
                return {
                    authKind: authKind === 'token' || authKind === 'tmpauth' ? authKind : 'password',
                    username: currentUser.name,
                    token: options.authInfo.token,
                    tokenId: options.authInfo.tokenId || ''
                };
            }
        }

        // Possible user has entered the API token instead of the password.
        if (options.authInfo.password) {
            const currentUser = await getCurrentUser(
                options.baseUrl,
                options.authInfo.password,
                this.fetch,
                token
            ).catch(() => undefined);
            if (currentUser?.name) {
                return {
                    authKind: 'token',
                    username: currentUser.name,
                    token: options.authInfo.password,
                    tokenId: ''
                };
            }
        }

        if (!options.authInfo.username) {
            throw new JupyterHubMissingUsernameError();
        }
        const generatedAuth = await generateNewApiToken(
            options.baseUrl,
            options.authInfo.username,
            options.authInfo.password,
            this.fetch,
            token
        );
        return {
            authKind: 'password',
            username: options.authInfo.username,
            token: generatedAuth.token,
            tokenId: generatedAuth.tokenId
        };
    }
}
