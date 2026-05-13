// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as nodeFetch from 'node-fetch';
import { CancellationToken } from 'vscode';
import { raceCancellationError } from './common/async';
import { traceDebug } from './common/logging';
import { generateNewApiTokenFromSession, type ApiTypes } from './jupyterHubApi';
import { ITmpAuthenticatorBootstrapper, JupyterHubResolvedAuthInfo } from './types';
import { appendUrlPath } from './utils';

const MAX_REDIRECTS = 10;

export class TmpAuthenticatorBootstrapper implements ITmpAuthenticatorBootstrapper {
    private readonly cookies = new Map<string, string>();
    constructor(private readonly nodeFetchImpl: typeof nodeFetch = nodeFetch) {}
    public async tryBootstrapJupyterHubAuth(
        baseUrl: string,
        token: CancellationToken
    ): Promise<JupyterHubResolvedAuthInfo | undefined> {
        this.cookies.clear();

        traceDebug(`Attempting tmpauth bootstrap for ${baseUrl}`);
        await this.request(appendUrlPath(baseUrl, 'hub/home'), { method: 'GET' }, token);

        let currentUser = await this.getCurrentUserFromSession(baseUrl, token);
        if (!currentUser?.name) {
            const loginResponse = await this.request(appendUrlPath(baseUrl, 'hub/login'), { method: 'GET' }, token);
            const loginPage = await loginResponse.text().catch(() => '');
            const shouldVisitTmpLogin =
                loginResponse.url.includes('/hub/tmplogin') || loginPage.includes('/hub/tmplogin');
            if (!shouldVisitTmpLogin) {
                traceDebug(`Tmpauth bootstrap unavailable for ${baseUrl}`);
                return;
            }
            await this.request(appendUrlPath(baseUrl, 'hub/tmplogin'), { method: 'GET' }, token);
            currentUser = await this.getCurrentUserFromSession(baseUrl, token);
        }

        if (!currentUser?.name) {
            traceDebug(`Tmpauth bootstrap failed to discover a current user for ${baseUrl}`);
            return;
        }

        const xsrfToken = this.cookies.get('_xsrf') || '';
        const referer = appendUrlPath(baseUrl, 'hub/');
        const sessionAuth = await generateNewApiTokenFromSession(
            baseUrl,
            currentUser.name,
            (url, options) => this.request(url, options, token, false),
            xsrfToken,
            referer
        );
        traceDebug(`Tmpauth bootstrap created a token for ${baseUrl}`);
        return {
            authKind: 'tmpauth',
            username: currentUser.name,
            token: sessionAuth.token,
            tokenId: sessionAuth.tokenId
        };
    }

    private async getCurrentUserFromSession(
        baseUrl: string,
        token: CancellationToken
    ): Promise<ApiTypes.CurrentUserInfo | undefined> {
        const xsrfToken = this.cookies.get('_xsrf') || '';
        const headers: Record<string, string> = {
            Accept: 'application/json',
            Referer: appendUrlPath(baseUrl, 'hub/')
        };
        if (xsrfToken) {
            headers['X-XSRFToken'] = xsrfToken;
        }
        const response = await this.request(
            appendUrlPath(baseUrl, 'hub/api/user'),
            { method: 'GET', headers },
            token,
            false
        );
        if (response.status !== 200) {
            return;
        }
        return (await response.json()) as ApiTypes.CurrentUserInfo;
    }

    private async request(
        url: string,
        options: RequestInit,
        token: CancellationToken,
        followRedirects = true,
        redirectCount = 0
    ): Promise<nodeFetch.Response> {
        const headers = new this.nodeFetchImpl.Headers(options.headers as nodeFetch.HeadersInit | undefined);
        const cookieHeader = this.getCookieHeader();
        if (cookieHeader) {
            headers.set('Cookie', cookieHeader);
        }
        const requestOptions: nodeFetch.RequestInit = {
            method: options.method as nodeFetch.RequestInit['method'],
            headers: headers as unknown as nodeFetch.HeadersInit,
            redirect: 'manual'
        };
        if (options.body !== undefined && options.body !== null) {
            requestOptions.body = options.body as unknown as nodeFetch.BodyInit;
        }
        const response = await raceCancellationError(token, this.nodeFetchImpl.default(url, requestOptions));
        this.updateCookies(response);

        if (followRedirects && this.isRedirect(response) && redirectCount < MAX_REDIRECTS) {
            const location = response.headers.get('location');
            if (location) {
                return this.request(
                    new URL(location, url).toString(),
                    { method: 'GET' },
                    token,
                    true,
                    redirectCount + 1
                );
            }
        }
        return response;
    }

    private getCookieHeader() {
        return Array.from(this.cookies.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
    }

    private updateCookies(response: nodeFetch.Response) {
        const raw = response.headers.raw()['set-cookie'] || [];
        raw.forEach((item) => {
            const cookie = item.split(';', 1)[0];
            const separatorIndex = cookie.indexOf('=');
            if (separatorIndex > 0) {
                const name = cookie.substring(0, separatorIndex);
                const value = cookie.substring(separatorIndex + 1);
                this.cookies.set(name, value);
            }
        });
    }

    private isRedirect(response: nodeFetch.Response) {
        return response.status >= 300 && response.status < 400;
    }
}
