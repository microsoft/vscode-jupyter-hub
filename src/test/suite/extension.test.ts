// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as os from 'os';
import { assert, expect } from 'chai';
import { NewAuthenticator } from '../../authenticators/authenticator';
import { CancellationTokenSource, Uri, workspace } from 'vscode';
import { IDisposable } from '../../common/lifecycle';
import { activateHubExtension } from './helpers';
import { noop } from '../../common/utils';
import { SimpleFetch } from '../../common/request';
import { JupyterHubConnectionValidator } from '../../validator';
import { ClassType } from '../../common/types';
import { BaseCookieStore } from '../../common/cookieStore.base';
import { IJupyterRequestCreator } from '../../types';

describe('Authentication', function () {
    let baseUrl = 'http://localhost:8000';
    let hubToken = '';
    // const anotherUserName = 'joe'; // Defined in config file.
    let cancellationToken: CancellationTokenSource;
    const disposables: IDisposable[] = [];
    this.timeout(100_000);
    let RequestCreator: ClassType<IJupyterRequestCreator>;
    let CookieStore: ClassType<BaseCookieStore>;
    const username = os.userInfo().username;
    before(async function () {
        this.timeout(100_000);
        const file = Uri.joinPath(workspace.workspaceFolders![0].uri, 'jupyterhub.json');
        const promise = activateHubExtension().then((classes) => {
            RequestCreator = classes!.RequestCreator;
            CookieStore = classes!.CookieStore;
        });

        activateHubExtension().catch(noop);
        cancellationToken = new CancellationTokenSource();
        disposables.push(cancellationToken);
        const { url, token } = JSON.parse(Buffer.from(await workspace.fs.readFile(file)).toString());
        baseUrl = url;
        hubToken = token;
        assert.ok(baseUrl, 'No JupyterHub url');
        assert.ok(hubToken, 'No JupyterHub token');
        await promise;
    });

    // [
    //     { title: 'logged in user', username: os.userInfo().username },
    //     { title: 'another user (joe)', username: anotherUserName }
    // ].forEach(({ title, username }) => {
    //     describe(title, function () {
    [
        { title: 'password', password: () => 'pwd', isApiToken: false },
        { title: 'token', password: () => hubToken, isApiToken: true }
    ].forEach(({ title, password, isApiToken }) => {
        describe(title, function () {
            it('should get Hub auth info', async () => {
                const authenticator = new NewAuthenticator(new SimpleFetch(new RequestCreator()), CookieStore);
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
                const authenticator = new NewAuthenticator(new SimpleFetch(new RequestCreator()), CookieStore);
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
                const authenticator = new NewAuthenticator(new SimpleFetch(new RequestCreator()), CookieStore);
                const validator = new JupyterHubConnectionValidator(new SimpleFetch(new RequestCreator()));
                await validator.validateJupyterUri(
                    baseUrl,
                    { username, password: password() },
                    authenticator,
                    cancellationToken.token
                );
            });
        });
    });
});
