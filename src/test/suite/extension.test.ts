// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert, expect } from 'chai';
import { NewAuthenticator } from '../../authenticators/authenticator';
import { CancellationTokenSource, Uri, workspace } from 'vscode';
import { DisposableStore, IDisposable } from '../../common/lifecycle';
import { activateHubExtension } from './helpers';
import { noop } from '../../common/utils';
import { SimpleFetch } from '../../common/request';
import { JupyterHubConnectionValidator, getKernelSpecs } from '../../validator';
import { ClassType } from '../../common/types';
import { BaseCookieStore } from '../../common/cookieStore.base';
import { IJupyterRequestCreator } from '../../types';
import { createServerConnectSettings } from '../../jupyterHubApi';
import { KernelManager, SessionManager } from '@jupyterlab/services';

const TIMEOUT = 30_000; // Spinning up jupyter servers could take a while.
import { isWebExtension } from '../../utils';

describe('Authentication', function () {
    let baseUrl = 'http://localhost:8000';
    let hubToken = '';
    let username = '';
    let cancellationToken: CancellationTokenSource;
    const disposables: IDisposable[] = [];
    this.timeout(TIMEOUT);
    let RequestCreator: ClassType<IJupyterRequestCreator>;
    let CookieStore: ClassType<BaseCookieStore>;
    let disposableStore: DisposableStore;
    let authenticator: NewAuthenticator;
    let fetch: SimpleFetch;
    let requestCreator: IJupyterRequestCreator;
    before(async function () {
        this.timeout(TIMEOUT);
        const file = Uri.joinPath(workspace.workspaceFolders![0].uri, 'jupyterhub.json');
        const promise = activateHubExtension().then((classes) => {
            RequestCreator = classes!.RequestCreator;
            CookieStore = classes!.CookieStore;
        });

        activateHubExtension().catch(noop);
        cancellationToken = new CancellationTokenSource();
        disposables.push(cancellationToken);
        const { url, token, username: user } = JSON.parse(Buffer.from(await workspace.fs.readFile(file)).toString());
        baseUrl = url;
        username = user;
        hubToken = token;
        assert.ok(baseUrl, 'No JupyterHub url');
        assert.ok(hubToken, 'No JupyterHub token');
        await promise;
    });
    beforeEach(() => {
        disposableStore = new DisposableStore();
        requestCreator = new RequestCreator();
        fetch = new SimpleFetch(requestCreator);
        authenticator = disposableStore.add(new NewAuthenticator(fetch, CookieStore));
    });
    afterEach(() => disposableStore.dispose());

    [
        { title: 'password', password: () => 'pwd', isApiToken: false },
        { title: 'token', password: () => hubToken, isApiToken: true }
    ].forEach(({ title, password, isApiToken }) => {
        describe(title, function () {
            before(function () {
                if (isWebExtension() && !isApiToken) {
                    // Web does not support passwords.
                    return this.skip();
                }
            });

            it.only('should be able to query kernelspecs', async function () {
                if (isWebExtension() && !isApiToken) {
                    // Web does not support passwords.
                    return this.skip();
                }
                const headers = {
                    Authorization: `token ${hubToken}`
                };
                console.error(`headers ${JSON.stringify(headers)}`);
                const fetch = new SimpleFetch(new RequestCreator());
                const response = await fetch.send(
                    'http://localhost:8000/user/donjayamanne/api/kernelspecs',
                    { method: 'GET', headers },
                    cancellationToken.token
                );
                expect(response).to.have.property('status', 200);
            });
            it('should get Hub auth info', async () => {
                const { headers } = await authenticator.getHubApiAuthInfo(
                    { baseUrl, authInfo: { username, password: password() } },
                    cancellationToken.token
                );
                expect(headers).to.be.an('object');
                if (!isApiToken) {
                    expect(headers).to.include.keys('_xsrf', 'Cookie', 'X-Xsrftoken');
                    expect(headers).to.not.include.keys('Authorization');
                } else {
                    expect(headers).to.not.include.keys('_xsrf', 'Cookie', 'X-Xsrftoken');
                    expect(headers).to.include.keys('Authorization');
                    expect(headers['Authorization']).to.be.equal(`token ${hubToken}`);
                }
            });
            it('should get Jupyter auth info', async () => {
                const { headers } = await authenticator.getJupyterAuthInfo(
                    { baseUrl, authInfo: { username, password: password() } },
                    cancellationToken.token
                );
                expect(headers).to.be.an('object');
                if (!isApiToken) {
                    expect(headers).to.include.keys('_xsrf', 'Cookie', 'X-Xsrftoken');
                    expect(headers).to.not.include.keys('Authorization');
                } else {
                    expect(headers).to.not.include.keys('_xsrf', 'Cookie', 'X-Xsrftoken');
                    expect(headers).to.include.keys('Authorization');
                    expect(headers['Authorization']).to.be.equal(`token ${hubToken}`);
                }
            });
            it('should pass validation', async function () {
                const validator = new JupyterHubConnectionValidator(fetch);
                await validator.validateJupyterUri(
                    baseUrl,
                    { username, password: password() },
                    authenticator,
                    cancellationToken.token
                );
            });
            it('should be able to start a session', async function () {
                // Found while dev that even though we get the cookies/headers and the like
                // Some paths in the app like retrieving kernel specs/sessions can be succesful,
                // However if we try to start a session, it fails. This is because the cookies that we extracted was not correct.
                const { headers } = await authenticator.getJupyterAuthInfo(
                    { baseUrl, authInfo: { username, password: password() } },
                    cancellationToken.token
                );
                const serverSettings = createServerConnectSettings(
                    baseUrl,
                    { username: username, headers },
                    requestCreator
                );
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
                await Promise.all([session.shutdown(), kernelManager.shutdownAll()]);
            });
        });
    });
});
