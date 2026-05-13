// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as nodeFetch from 'node-fetch';
import { TmpAuthenticatorBootstrapper } from '../../tmpAuthBootstrapper.node';

type FetchCall = { url: string; init: nodeFetch.RequestInit };

function createCancellationToken() {
    return {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose() {} })
    };
}

function createResponse(
    body: string,
    options: { status: number; url: string; location?: string; setCookies?: string[] }
) {
    const headers = new nodeFetch.Headers();
    if (options.location) {
        headers.set('location', options.location);
    }
    (options.setCookies || []).forEach((cookie) => headers.append('set-cookie', cookie));
    const response = new nodeFetch.Response(body, { status: options.status, headers });
    Object.defineProperty(response, 'url', { value: options.url });
    return response;
}

describe('TmpAuthenticatorBootstrapper', () => {
    let calls: FetchCall[];
    let queuedResponses: Map<string, nodeFetch.Response[]>;

    beforeEach(() => {
        calls = [];
        queuedResponses = new Map();
    });

    function enqueue(url: string, ...responses: nodeFetch.Response[]) {
        queuedResponses.set(url, responses);
    }

    function createBootstrapper() {
        return new TmpAuthenticatorBootstrapper({
            Headers: nodeFetch.Headers,
            default: async (url: string, init: nodeFetch.RequestInit) => {
                calls.push({ url, init });
                const queue = queuedResponses.get(url) || [];
                const response = queue.shift();
                if (!response) {
                    throw new Error(`Unexpected request: ${url}`);
                }
                queuedResponses.set(url, queue);
                return response;
            }
        } as typeof nodeFetch);
    }

    it('bootstraps tmpauth from a login page that links to tmplogin', async () => {
        const baseUrl = 'http://localhost:8000';
        const homeUrl = `${baseUrl}/hub/home`;
        const loginUrl = `${baseUrl}/hub/login`;
        const tmpLoginUrl = `${baseUrl}/hub/tmplogin`;
        const apiUserUrl = `${baseUrl}/hub/api/user`;
        const tokenUrl = `${baseUrl}/hub/api/users/tmp-user/tokens`;

        enqueue(
            homeUrl,
            createResponse('<html>login</html>', {
                status: 200,
                url: homeUrl,
                setCookies: ['_xsrf=csrf0; Path=/hub/']
            }),
            createResponse('<html>home</html>', {
                status: 200,
                url: homeUrl,
                setCookies: ['_xsrf=csrf1; Path=/hub/']
            })
        );
        enqueue(
            apiUserUrl,
            createResponse('{}', { status: 403, url: apiUserUrl }),
            createResponse(JSON.stringify({ name: 'tmp-user' }), { status: 200, url: apiUserUrl })
        );
        enqueue(
            loginUrl,
            createResponse('<a href="/hub/tmplogin">Sign in</a>', {
                status: 200,
                url: loginUrl
            })
        );
        enqueue(
            tmpLoginUrl,
            createResponse('', {
                status: 302,
                url: tmpLoginUrl,
                location: '/hub/home',
                setCookies: ['jupyterhub-hub-login=session; Path=/hub/']
            })
        );
        enqueue(
            tokenUrl,
            createResponse(JSON.stringify({ id: 'a1', token: 'bootstrap-token', user: 'tmp-user' }), {
                status: 201,
                url: tokenUrl
            })
        );

        const bootstrapper = createBootstrapper();
        const result = await bootstrapper.tryBootstrapJupyterHubAuth(baseUrl, createCancellationToken() as any);

        expect(result).to.deep.equal({
            authKind: 'tmpauth',
            username: 'tmp-user',
            token: 'bootstrap-token',
            tokenId: 'a1'
        });
        const postCall = calls.find((call) => call.url === tokenUrl);
        expect(postCall).to.not.be.undefined;
        const postHeaders = postCall!.init.headers as nodeFetch.Headers;
        expect(postHeaders.get('X-XSRFToken')).to.equal('csrf1');
        expect(postHeaders.get('Cookie')).to.include('jupyterhub-hub-login=session');
    });

    it('returns undefined when the hub login flow is not tmpauth-based', async () => {
        const baseUrl = 'http://localhost:8000';
        const homeUrl = `${baseUrl}/hub/home`;
        const loginUrl = `${baseUrl}/hub/login`;
        const apiUserUrl = `${baseUrl}/hub/api/user`;

        enqueue(
            homeUrl,
            createResponse('<html>login</html>', {
                status: 200,
                url: homeUrl,
                setCookies: ['_xsrf=csrf0; Path=/hub/']
            })
        );
        enqueue(apiUserUrl, createResponse('{}', { status: 403, url: apiUserUrl }));
        enqueue(loginUrl, createResponse('<form action="/hub/login"></form>', { status: 200, url: loginUrl }));

        const bootstrapper = createBootstrapper();
        const result = await bootstrapper.tryBootstrapJupyterHubAuth(baseUrl, createCancellationToken() as any);

        expect(result).to.be.undefined;
        expect(calls.map((call) => call.url)).to.deep.equal([homeUrl, apiUserUrl, loginUrl]);
    });
});
