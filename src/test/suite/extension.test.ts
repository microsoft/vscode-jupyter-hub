// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert, expect } from 'chai';
import { Authenticator } from '../../authenticator';
import { CancellationTokenSource, Uri, workspace } from 'vscode';
import { DisposableStore } from '../../common/lifecycle';
import { activateHubExtension, getWebSocketCreator } from './helpers';
import { noop } from '../../common/utils';
import { SimpleFetch } from '../../common/request';
import { JupyterHubConnectionValidator, getKernelSpecs } from '../../validator';
import { ClassType, ReadWrite } from '../../common/types';
import { IJupyterRequestCreator } from '../../types';
import { createServerConnectSettings, deleteApiToken } from '../../jupyterHubApi';
import { KernelManager, SessionManager } from '@jupyterlab/services';

const TIMEOUT = 30_000; // Spinning up jupyter servers could take a while.
describe('Authentication', function () {
    let baseUrl = 'http://localhost:8000';
    let apiToken = '';
    let username = '';
    let cancellationToken: CancellationTokenSource;
    this.timeout(TIMEOUT);
    let RequestCreator: ClassType<IJupyterRequestCreator>;
    let disposableStore: DisposableStore;
    let authenticator: Authenticator;
    let fetch: SimpleFetch;
    let requestCreator: IJupyterRequestCreator;
    let generatedTokens: { token: string; tokenId: string }[] = [];
    before(async function () {
        this.timeout(TIMEOUT);
        const file = Uri.joinPath(workspace.workspaceFolders![0].uri, 'jupyterhub.json');
        await activateHubExtension().then((classes) => {
            RequestCreator = classes.RequestCreator;
        });

        requestCreator = new RequestCreator();
        fetch = new SimpleFetch(requestCreator);
        authenticator = new Authenticator(fetch);
        cancellationToken = new CancellationTokenSource();
        const { url, username: user } = JSON.parse(Buffer.from(await workspace.fs.readFile(file)).toString());
        baseUrl = url;
        username = user;
        const { token } = await generateToken('pwd');
        apiToken = token;
        assert.ok(baseUrl, 'No JupyterHub url');
        assert.ok(apiToken, 'No JupyterHub token');
    });
    beforeEach(() => (disposableStore = new DisposableStore()));
    afterEach(() => disposableStore.dispose());
    after(async () => {
        // Delete all tokens generated.
        await Promise.all(
            generatedTokens.map((item) =>
                deleteApiToken(baseUrl, username, item.tokenId, item.token, fetch, cancellationToken.token).catch(noop)
            )
        );
        cancellationToken.dispose();
    });

    async function generateToken(password: string) {
        const { token, tokenId } = await authenticator.getJupyterAuthInfo(
            { baseUrl, authInfo: { username, password, token: '' } },
            cancellationToken.token
        );
        expect(token).to.be.a('string').that.is.not.equal('');
        if (password !== token) {
            expect(tokenId).to.be.a('string').that.is.not.equal('');
        }
        generatedTokens.push({ token, tokenId });
        return { token, tokenId };
    }
    [
        { title: 'password', password: () => 'pwd' }, // Test with password.
        { title: 'token', password: () => apiToken } // Test with a user entered API token.
    ].forEach(({ title, password }) => {
        describe(title, function () {
            it('should get Auth info', async () => {
                const { token } = await generateToken(password());
                expect(token).to.be.a('string').that.is.not.equal('');
            });
            it('should pass validation', async function () {
                const { token } = await generateToken(password());

                const validator = new JupyterHubConnectionValidator(fetch);
                await validator.validateJupyterUri(
                    baseUrl,
                    { username, password: password(), token },
                    authenticator,
                    cancellationToken.token
                );
            });
            it('should be able to start a session', async function () {
                const { token } = await generateToken(password());
                const serverSettings = createServerConnectSettings(
                    baseUrl,
                    { username: username, token },
                    requestCreator
                );
                (serverSettings as ReadWrite<typeof serverSettings>).WebSocket = getWebSocketCreator()(
                    undefined,
                    true,
                    () => ({
                        Authorization: `token ${token}`
                    }),
                    () => []
                ) as any;

                const kernelSpecs = await getKernelSpecs(serverSettings, cancellationToken.token);
                if (!kernelSpecs) {
                    throw new Error('No kernel specs');
                }
                const kernelManager = disposableStore.add(new KernelManager({ serverSettings }));
                await kernelManager.ready;

                const sessionManager = disposableStore.add(new SessionManager({ serverSettings, kernelManager }));
                await sessionManager.ready;
                const session = await sessionManager.startNew({
                    name: kernelSpecs.default,
                    path: 'one.ipynb',
                    type: 'notebook'
                });
                expect(session.model.kernel?.name).to.be.equal(kernelSpecs.default);
                expect(session.model.path).to.be.equal('one.ipynb');
                expect(session.model.type).to.be.equal('notebook');
                await Promise.all([session.shutdown().catch(noop), kernelManager.shutdownAll().catch(noop)]);
            });
        });
    });
});
