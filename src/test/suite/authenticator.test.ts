// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as sinon from 'sinon';
import { Authenticator } from '../../authenticator';
import { SimpleFetch } from '../../common/request';
import {
    ITmpAuthenticatorBootstrapper,
    JupyterHubAuthInfo,
    JupyterHubMissingUsernameError,
    JupyterHubResolvedAuthInfo
} from '../../types';

function createAuthInfo(overrides: Partial<JupyterHubAuthInfo> = {}): JupyterHubAuthInfo {
    return {
        authKind: 'password',
        username: '',
        password: '',
        token: '',
        tokenId: '',
        ...overrides
    };
}

function createResponse(status: number, body: unknown) {
    return {
        status,
        statusText: status === 200 ? 'OK' : 'Forbidden',
        json: async () => body,
        text: async () => JSON.stringify(body)
    } as Response;
}

function createCancellationToken() {
    return {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose() {} })
    };
}

describe('Authenticator Unit', () => {
    let send: sinon.SinonStub;
    let fetch: SimpleFetch;

    beforeEach(() => {
        send = sinon.stub();
        fetch = { send } as unknown as SimpleFetch;
    });
    afterEach(() => sinon.restore());

    it('discovers the username from a token-only login', async () => {
        send.callsFake(async (_url: string, options: RequestInit) => {
            expect(options.headers).to.deep.equal({ Authorization: 'token api-token' });
            return createResponse(200, { name: 'tmp-user' });
        });

        const authenticator = new Authenticator(fetch);
        const result = await authenticator.getJupyterAuthInfo(
            {
                baseUrl: 'http://localhost:8000',
                authInfo: createAuthInfo({ authKind: 'token', token: 'api-token' })
            },
            createCancellationToken() as any
        );

        expect(result).to.deep.equal({
            authKind: 'token',
            username: 'tmp-user',
            token: 'api-token',
            tokenId: ''
        });
    });

    it('preserves password auth when an existing password-backed token is still valid', async () => {
        send.resolves(createResponse(200, { name: 'persisted-user' }));

        const authenticator = new Authenticator(fetch);
        const result = await authenticator.getJupyterAuthInfo(
            {
                baseUrl: 'http://localhost:8000',
                authInfo: createAuthInfo({
                    authKind: 'password',
                    username: 'persisted-user',
                    password: 'pwd',
                    token: 'existing-token',
                    tokenId: 'a1'
                })
            },
            createCancellationToken() as any
        );

        expect(result).to.deep.equal({
            authKind: 'password',
            username: 'persisted-user',
            token: 'existing-token',
            tokenId: 'a1'
        });
    });

    it('requires a username when password auth cannot fall back to token auth', async () => {
        send.rejects(new Error('Forbidden'));

        const authenticator = new Authenticator(fetch);
        let thrown: unknown;
        try {
            await authenticator.getJupyterAuthInfo(
                {
                    baseUrl: 'http://localhost:8000',
                    authInfo: createAuthInfo({ password: 'not-a-token' })
                },
                createCancellationToken() as any
            );
        } catch (ex) {
            thrown = ex;
        }

        expect(thrown).to.be.instanceOf(JupyterHubMissingUsernameError);
    });

    it('reruns tmpauth bootstrap when the stored tmpauth token is no longer valid', async () => {
        send.rejects(new Error('Forbidden'));
        const bootstrapResult: JupyterHubResolvedAuthInfo = {
            authKind: 'tmpauth',
            username: 'new-temp-user',
            token: 'new-token',
            tokenId: 'a2'
        };
        const bootstrapper: ITmpAuthenticatorBootstrapper = {
            tryBootstrapJupyterHubAuth: sinon.stub().resolves(bootstrapResult)
        };

        const authenticator = new Authenticator(fetch, bootstrapper);
        const result = await authenticator.getJupyterAuthInfo(
            {
                baseUrl: 'http://localhost:8000',
                authInfo: createAuthInfo({
                    authKind: 'tmpauth',
                    username: 'old-temp-user',
                    token: 'expired-token'
                })
            },
            createCancellationToken() as any
        );

        expect(result).to.deep.equal(bootstrapResult);
        sinon.assert.calledOnce(bootstrapper.tryBootstrapJupyterHubAuth as sinon.SinonStub);
    });
});
