// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CancellationTokenSource } from 'vscode';
import { SimpleFetch } from '../common/request';
import { IAuthenticator } from './types';
import { BaseCookieStore } from '../common/cookieStore.base';
import { appendUrlPath, isWebExtension } from '../utils';
import { ClassType } from '../common/types';
import {
    getJupyterHubBaseUrl,
    getHubApiUrl,
    getJupyterUrl,
    getJupyterLogoutUrl,
    getHubLogoutUrl
} from '../jupyterHubApi';
import { noop } from '../common/utils';

export class NewAuthenticator implements IAuthenticator {
    private readonly logoutUrls: { url: string; headers: Record<string, string> }[] = [];
    constructor(
        private readonly fetch: SimpleFetch,
        private readonly CookieStore: ClassType<BaseCookieStore>
    ) {}
    dispose() {
        const token = new CancellationTokenSource();
        this.logoutUrls.forEach((item) =>
            this.fetch.send(item.url, { method: 'GET', headers: item.headers }, token.token).catch(noop)
        );
        token.dispose();
    }
    public async getJupyterAuthInfo(
        options: {
            baseUrl: string;
            authInfo: {
                username: string;
                password: string;
            };
        },
        token: CancellationToken
    ): Promise<{ headers: Record<string, string> }> {
        if (isWebExtension()) {
            return {
                headers: this.getAuthTokenHeaders(options.authInfo.password)
            };
        }
        const isAuthToken = await this.isPasswordAnAuthToken(options, token);
        if (isAuthToken) {
            return {
                headers: this.getAuthTokenHeaders(options.authInfo.password)
            };
        }
        const cookieStore = new this.CookieStore();
        await this.getBaseAuthInfo(options, cookieStore, token);
        const jupyterHubUrl = getJupyterUrl(options.baseUrl, options.authInfo.username);
        this.trackLogoutUrl(options.authInfo.username, options.baseUrl, cookieStore);
        return this.getHeadersToSend(options.authInfo.username, jupyterHubUrl, cookieStore);
    }
    public async getHubApiAuthInfo(
        options: {
            baseUrl: string;
            authInfo: {
                username: string;
                password: string;
            };
        },
        token: CancellationToken
    ): Promise<{ headers: Record<string, string> }> {
        const isAuthToken = await this.isPasswordAnAuthToken(options, token);
        if (isAuthToken) {
            return {
                headers: this.getAuthTokenHeaders(options.authInfo.password)
            };
        }
        const cookieStore = new this.CookieStore();
        await this.getBaseAuthInfo(options, cookieStore, token);
        const apiUrl = getHubApiUrl(options.baseUrl);
        this.trackLogoutUrl(options.authInfo.username, options.baseUrl, cookieStore);
        return this.getHeadersToSend(options.authInfo.username, apiUrl, cookieStore);
    }
    private trackLogoutUrl(username: string, baseUrl: string, cookieStore: BaseCookieStore) {
        const jupyterLogoutUrl = getJupyterLogoutUrl(baseUrl, username);
        this.logoutUrls.push({
            url: jupyterLogoutUrl,
            headers: this.getHeadersToSend(username, jupyterLogoutUrl, cookieStore).headers
        });
        const hubLogoutUrl = getHubLogoutUrl(baseUrl);
        this.logoutUrls.push({
            url: hubLogoutUrl,
            headers: this.getHeadersToSend(username, hubLogoutUrl, cookieStore).headers
        });
    }
    private getHeadersToSend(username: string, location: string, cookieStore: BaseCookieStore) {
        // This should not be sent, else we get a 403.
        // Once we've successfully logged in these cookies are cleared out with empty values.
        const cookieToExclude = `jupyterhub-user-${username}-oauth-state=`;
        return {
            headers: {
                Cookie: cookieStore
                    .getCookiesToSend(location)
                    .filter((c) => !c.startsWith(cookieToExclude))
                    .join('; '),
                _xsrf: cookieStore.getXsrfToken(location),
                // Without X-xsrftoken, Sessions API fails to create new sessions.
                'X-Xsrftoken': cookieStore.getXsrfToken(location)
            }
        };
    }
    private getAuthTokenHeaders(token: string): Record<string, string> {
        if (isWebExtension()) {
            // For web, we cannot send `Cache-Control` or other headers/
            // The response for OPTIONS will let us know in
            // `Access-Control-Allow-Headers` what headers we can send.
            return {
                Authorization: `token ${token}`
            };
        }

        return {
            Connection: 'keep-alive',
            'Cache-Control': 'no-cache',
            Authorization: `token ${token}`
        };
    }
    private async isPasswordAnAuthToken(
        options: {
            baseUrl: string;
            authInfo: {
                username: string;
                password: string;
            };
        },
        token: CancellationToken
    ) {
        const baseUrl = await getJupyterHubBaseUrl(options.baseUrl, this.fetch, token);
        if (isWebExtension()) {
            return true;
        }
        // Open login page.
        let location = appendUrlPath(baseUrl, 'api/user');
        const response = await this.fetch.send(
            location,
            {
                method: 'GET',
                headers: {
                    Connection: 'keep-alive',
                    'Cache-Control': 'no-cache',
                    Authorization: `token ${options.authInfo.password}`
                }
            },
            token
        );

        return response.status === 200;
    }

    private async getBaseAuthInfo(
        options: {
            baseUrl: string;
            authInfo: {
                username: string;
                password: string;
            };
        },
        cookieStore: BaseCookieStore,
        token: CancellationToken
    ): Promise<void> {
        const baseUrl = await getJupyterHubBaseUrl(options.baseUrl, this.fetch, token);
        // Open login page.
        let location = appendUrlPath(baseUrl, 'hub/login?next=');
        let response = await this.fetch.send(
            location,
            {
                method: 'GET',
                headers: {
                    Connection: 'keep-alive',
                    'Cache-Control': 'no-cache'
                },
                redirect: 'manual'
            },
            token
        );
        cookieStore.trackCookies(response);

        // Login with username/password
        const postParams = new URLSearchParams();
        postParams.append('username', options.authInfo.username);
        postParams.append('password', options.authInfo.password);
        postParams.append('_xsrf', cookieStore.getXsrfToken(location));
        response = await this.fetch.send(
            location,
            {
                method: 'POST',
                headers: {
                    Connection: 'keep-alive',
                    Referer: location,
                    'Cache-Control': 'no-cache',
                    Cookie: cookieStore.getCookiesToSend(location).join('; '),
                    _xsrf: cookieStore.getXsrfToken(location),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: postParams.toString(),
                redirect: 'manual'
            },
            token
        );

        // Generate the session and user cookies
        // First redirect to user page /users/<username>
        // Then redirect to .... & so on.
        // We need to keep following the redirects and sending the right cookies based on the paths.
        while (response.status === 302) {
            const location = response.headers.get('location')!;
            cookieStore.trackCookies(response);
            response = await this.fetch.send(
                location,
                {
                    method: 'GET',
                    headers: {
                        Connection: 'keep-alive',
                        'Cache-Control': 'no-cache',
                        Cookie: cookieStore.getCookiesToSend(location).join('; '),
                        _xsrf: cookieStore.getXsrfToken(location)
                    },
                    redirect: 'manual'
                },
                token
            );
        }

        cookieStore.trackCookies(response);
    }
}
