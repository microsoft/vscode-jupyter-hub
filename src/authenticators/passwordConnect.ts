// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, CancellationToken, CancellationTokenSource } from 'vscode';
import { SimpleFetch } from '../common/request';
import { IDisposable, dispose } from '../common/lifecycle';
import { noop } from '../common/utils';
import { AuthenticationNotSupportedError, IAuthenticator } from './types';
import { traceError } from '../common/logging';
import { appendUrlPath } from '../utils';

/**
 * Old Jupyter Hub auth class from Jupyter Extension.
 * This used to attempt to generate tokens and use that for authentication.
 * Unfortunately this no longer works with the latest versions (at least since 2020) of JupyterHub.
 */
export class OldUserNamePasswordAuthenticator implements IAuthenticator {
    private readonly disposables: IDisposable[] = [];
    constructor(private readonly fetch: SimpleFetch) {}
    dispose() {
        dispose(this.disposables);
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
    ): Promise<{ token: string }> {
        // See if we already have this data. Don't need to ask for a password more than once. (This can happen in remote when listing kernels)
        try {
            // Try the login method. It should work and doesn't require a token to be generated.
            let auth = await this.getJupyterHubConnectionInfoFromLogin(
                options.baseUrl,
                options.authInfo?.username || '',
                options.authInfo?.password || '',
                token
            );

            if (auth) {
                // If login method fails, return the user name and password that was capture
                // We can do something with this later.
                return {
                    token: auth.token
                };
            }
            if (options.authInfo?.username || options.authInfo?.password) {
                auth = await this.getJupyterHubConnectionInfoFromApi(
                    options.baseUrl,
                    options.authInfo.username,
                    options.authInfo.password,
                    token
                );
            }
            if (auth) {
                // If login method fails, return the user name and password that was capture
                // We can do something with this later.
                return {
                    token: auth.token
                };
            }

            throw new AuthenticationNotSupportedError();
        } catch (ex) {
            if (ex instanceof AuthenticationNotSupportedError || ex instanceof CancellationError) {
                throw ex;
            }
            traceError('Failed to get auth info', ex);
            throw new AuthenticationNotSupportedError();
        }
    }

    private async getJupyterHubConnectionInfoFromLogin(
        uri: string,
        username: string,
        password: string,
        token: CancellationToken
    ): Promise<{ token: string } | undefined> {
        // We're using jupyter hub. Get the base url
        const url = new URL(uri);
        const baseUrl = `${url.protocol}//${url.host}`;

        const postParams = new URLSearchParams();
        postParams.append('username', username || '');
        postParams.append('password', password || '');

        let response = await this.fetch.send(
            appendUrlPath(baseUrl, `hub/login?next=`),
            {
                method: 'POST',
                headers: {
                    Connection: 'keep-alive',
                    Referer: appendUrlPath(baseUrl, `hub/login`),
                    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                body: postParams.toString(),
                redirect: 'manual'
            },
            token
        );

        // The cookies from that response should be used to make the next set of requests
        if (response && response.status === 302) {
            const cookies = this.getCookies(response);
            const cookieString = [...cookies.entries()].reduce((p, c) => `${p};${c[0]}=${c[1]}`, '');
            // See this API for creating a token
            // https://jupyterhub.readthedocs.io/en/stable/_static/rest-api/index.html#operation--users--name--tokens-post
            response = await this.fetch.send(
                appendUrlPath(baseUrl, `hub/api/users/${username}/tokens`),
                {
                    method: 'POST',
                    headers: {
                        Connection: 'keep-alive',
                        Cookie: cookieString,
                        Referer: appendUrlPath(baseUrl, `hub/login`)
                    }
                },
                token
            );

            // That should give us a new token. For now server name is hard coded. Not sure
            // how to fetch it other than in the info for a default token
            if (response.ok && response.status === 200) {
                const body = await response.json();
                if (body && body.token && body.id) {
                    // Response should have the token to use for this user.

                    // Make sure the server is running for this user. Don't need
                    // to check response as it will fail if already running.
                    // https://jupyterhub.readthedocs.io/en/stable/_static/rest-api/index.html#operation--users--name--server-post
                    await this.fetch.send(
                        appendUrlPath(baseUrl, `hub/api/users/${username}/server`),
                        {
                            method: 'POST',
                            headers: {
                                Connection: 'keep-alive',
                                Cookie: cookieString,
                                Referer: appendUrlPath(baseUrl, `hub/login`)
                            }
                        },
                        token
                    );

                    // This token was generated for this request. We should clean it up when
                    // the user closes VS code
                    this.disposables.push({
                        dispose: async () => {
                            const token = new CancellationTokenSource();
                            this.fetch
                                .send(
                                    appendUrlPath(baseUrl, `hub/api/users/${username}/tokens/${body.id}`),
                                    {
                                        method: 'DELETE',
                                        headers: {
                                            Connection: 'keep-alive',
                                            Cookie: cookieString,
                                            Referer: appendUrlPath(baseUrl, `hub/login`)
                                        }
                                    },
                                    token.token
                                )
                                .catch(noop)
                                .finally(() => token.dispose())
                                .catch(noop); // Don't wait for this during shutdown. Just make the request
                        }
                    });

                    return {
                        token: body.token
                    };
                }
            }
        }
    }

    private getCookies(response: Response): Map<string, string> {
        const cookieList: Map<string, string> = new Map<string, string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (response.headers as any).raw ? (response.headers as any).raw() : response.headers;

        const cookies = raw['set-cookie'];

        if (cookies) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cookies.forEach((value: any) => {
                const cookieKey = value.substring(0, value.indexOf('='));
                const cookieVal = value.substring(value.indexOf('=') + 1);
                cookieList.set(cookieKey, cookieVal);
            });
        }

        return cookieList;
    }
    private async getJupyterHubConnectionInfoFromApi(
        uri: string,
        username: string,
        password: string,
        token: CancellationToken
    ): Promise<{ token: string } | undefined> {
        // We're using jupyter hub. Get the base url
        const url = new URL(uri);
        const baseUrl = `${url.protocol}//${url.host}`;
        // Use these in a post request to get the token to use
        const response = await this.fetch.send(
            appendUrlPath(baseUrl, 'hub/api/authorizations/token'), // This seems to be deprecated, but it works. It requests a new token
            {
                method: 'POST',
                headers: {
                    Connection: 'keep-alive',
                    'content-type': 'application/json;charset=UTF-8'
                },
                body: `{ "username": "${username || ''}", "password": "${password || ''}"  }`,
                redirect: 'manual'
            },
            token
        );

        if (response.ok && response.status === 200) {
            const body = await response.json();
            if (body && body.user && body.user.server && body.token) {
                // Response should have the token to use for this user.
                return {
                    token: body.token
                };
            }
        }
    }
}
