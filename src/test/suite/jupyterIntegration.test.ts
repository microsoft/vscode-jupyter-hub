// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert, expect, use } from 'chai';
import * as sinon from 'sinon';
import { mock, instance, anything, when } from 'ts-mockito';
import * as nodeFetch from 'node-fetch';
import WebSocketIsomorphic from 'isomorphic-ws';
import chaiAsPromised from 'chai-as-promised';
import { Authenticator } from '../../authenticator';
import { CancellationTokenSource, type CancellationToken } from 'vscode';
import { DisposableStore } from '../../common/lifecycle';
import { noop } from '../../common/utils';
import { SimpleFetch } from '../../common/request';
import { JupyterHubConnectionValidator } from '../../validator';
import { type IAuthenticator } from '../../types';
import { JupyterServerIntegration } from '../../jupyterIntegration';
import type { JupyterHubServerStorage } from '../../storage';
import type { Jupyter, JupyterServer } from '@vscode/jupyter-extension';
import type { JupyterHubUrlCapture } from '../../urlCapture';
use(chaiAsPromised);

describe('Jupyter Integration', function () {
    let cancellationToken: CancellationTokenSource;
    let disposableStore: DisposableStore;
    let integration: JupyterServerIntegration;
    let fetch: SimpleFetch;
    let jupyterApi: Jupyter;
    let storage: JupyterHubServerStorage;
    let urlCapture: JupyterHubUrlCapture;
    let lastRequestInput: Request | undefined;
    let lastRequestInit: RequestInit | undefined;
    beforeEach(async function () {
        lastRequestInput = undefined;
        lastRequestInit = undefined;
        disposableStore = new DisposableStore();
        fetch = mock<SimpleFetch>();
        jupyterApi = mock<Jupyter>();
        storage = mock<JupyterHubServerStorage>();
        urlCapture = mock<JupyterHubUrlCapture>();
        cancellationToken = disposableStore.add(new CancellationTokenSource());

        when(jupyterApi.createJupyterServerCollection(anything(), anything(), anything())).thenReturn({
            dispose: noop
        } as any);
        when(storage.all).thenReturn([]);

        integration = new JupyterServerIntegration(
            instance(fetch),
            instance(jupyterApi),
            instance(storage),
            instance(urlCapture),
            {
                ...nodeFetch,
                default: ((req: any, init: any) => {
                    lastRequestInput = req;
                    lastRequestInit = init;
                    return Promise.resolve(new Response()) as any;
                }) as any
            }
        );
    });
    afterEach(() => disposableStore.dispose());

    describe('Initial state', function () {
        it('Should not provide one command', async () => {
            const commands = await integration.provideCommands('', cancellationToken.token);
            expect(commands).to.lengthOf(1);
        });
        it('Should return empty list of servers', async () => {
            const servers = await integration.provideJupyterServers(cancellationToken.token);
            expect(servers).to.lengthOf(0);
        });
        it('Should reject when attempting to resolve an unknown server', async () => {
            const promise = integration.resolveJupyterServer({ id: 'xyz' } as any, cancellationToken.token);
            await assert.isRejected(promise);
        });
    });
    describe('Entering a Url', function () {
        it('Should register a server', async () => {
            const commands = await integration.provideCommands('', cancellationToken.token);
            const url = 'http://localhost:8000';
            const serverToReturn: JupyterServer = {
                id: 'xyz',
                label: 'New Server'
            };

            when(
                urlCapture.captureRemoteJupyterUrl(anything(), url, anything(), undefined, anything(), anything())
            ).thenResolve(serverToReturn);

            const server = await integration.handleCommand({ ...commands[0], url }, cancellationToken.token);

            expect(server).not.to.be.undefined;
            expect(server?.id).to.be.equal('xyz');
            expect(server?.label).to.be.equal('New Server');
        });
    });
    describe('Resolve Server Info', function () {
        const url = 'http://localhost:8000';
        let server: JupyterServer;
        let stubbedAuth: sinon.SinonStub<
            [
                options: { baseUrl: string; authInfo: { username: string; password: string; token: string } },
                token: CancellationToken
            ],
            Promise<{ token: string; tokenId: string }>
        >;
        let stubbedValidator: sinon.SinonStub<
            [
                baseUrl: string,
                authInfo: { username: string; password: string; token: string },
                authenticator: IAuthenticator,
                mainCancel: CancellationToken
            ],
            Promise<void>
        >;
        let stubbedServerStarter: sinon.SinonStub<
            [
                baseUrl: string,
                serverName: string | undefined,
                authInfo: {
                    username: string;
                    password: string;
                    token: string;
                },
                authenticator: IAuthenticator,
                mainCancel: CancellationToken
            ],
            Promise<void>
        >;
        let resolvedServer: JupyterServer;

        beforeEach(async () => {
            const serverToReturn: JupyterServer = {
                id: 'xyz',
                label: 'New Server'
            };

            when(
                urlCapture.captureRemoteJupyterUrl(anything(), url, anything(), undefined, anything(), anything())
            ).thenResolve(serverToReturn);

            const commands = await integration.provideCommands('', cancellationToken.token);
            server = (await integration.handleCommand({ ...commands[0], url }, cancellationToken.token))!;

            when(storage.all).thenReturn([{ id: server.id, baseUrl: url, displayName: server.label }]);
            stubbedAuth = sinon.stub(Authenticator.prototype, 'getJupyterAuthInfo').callsFake(async () => {
                return {
                    token: '',
                    tokenId: ''
                };
            });
            stubbedValidator = sinon
                .stub(JupyterHubConnectionValidator.prototype, 'validateJupyterUri')
                .callsFake(async () => {
                    return;
                });
            stubbedServerStarter = sinon
                .stub(JupyterHubConnectionValidator.prototype, 'ensureServerIsRunning')
                .callsFake(async () => {
                    return;
                });

            when(
                fetch.send('http://localhost:8000/hub/api/users/joe@bloe%20(personal)', anything(), anything())
            ).thenResolve({
                status: 200,
                json: () =>
                    Promise.resolve({
                        name: 'joe@bloe (personal)',
                        server: 'user/joe@bloe%20%28personal%29/'
                    }) as any
            } as any);
            when(storage.getCredentials(server.id)).thenResolve({
                password: '',
                token: '',
                tokenId: '',
                username: 'joe@bloe (personal)'
            });
            resolvedServer = await integration.resolveJupyterServer(server, cancellationToken.token);
        });
        afterEach(() => {
            stubbedAuth.restore();
            stubbedValidator.restore();
            stubbedServerStarter.restore();
        });
        it('Will return the right url', async () => {
            expect(resolvedServer.connectionInformation).not.to.be.undefined;
            expect(resolvedServer.connectionInformation?.baseUrl.toString(true)).to.be.equal(
                `${url}/user/joe@bloe (personal)/`
            );
        });
        it('Should have custom fetch/WebSocket implementations', async () => {
            const { fetch, WebSocket }: { fetch: typeof nodeFetch.default; WebSocket: WebSocketIsomorphic } =
                resolvedServer.connectionInformation as any;

            expect(fetch).to.be.a('function');
            expect(WebSocket).to.be.a('function');
        });
        it('Should not encode @ and encode the rest', async () => {
            const { fetch, WebSocket }: { fetch: typeof nodeFetch.default; WebSocket: typeof WebSocketIsomorphic } =
                resolvedServer.connectionInformation as any;
            const brokenUrl = new nodeFetch.Request(resolvedServer.connectionInformation!.baseUrl.toString(true)).url;
            const request = new Request(brokenUrl);
            await fetch(request as any).catch(noop);

            expect(lastRequestInit).not.to.be.undefined;
            expect(lastRequestInput?.url).to.be.deep.equal('http://localhost:8000/user/joe@bloe%20%28personal%29/');
            const ws = new WebSocket(`${brokenUrl.replace('http', 'ws')}api/kernels`);
            expect(ws.url).to.be.equal('ws://localhost:8000/user/joe@bloe%20%28personal%29/api/kernels');
        });
    });
});
