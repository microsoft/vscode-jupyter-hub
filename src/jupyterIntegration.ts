// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as nodeFetch from 'node-fetch';
import WebSocketIsomorphic from 'isomorphic-ws';
import { CancellationError, CancellationToken, CancellationTokenSource, Disposable, EventEmitter, Uri } from 'vscode';
import type {
    Jupyter,
    JupyterServer,
    JupyterServerCommand,
    JupyterServerCommandProvider,
    JupyterServerProvider
} from '@vscode/jupyter-extension';
import { Localized } from './common/localize';
import { traceDebug, traceError } from './common/logging';
import { dispose } from './common/lifecycle';
import { JupyterHubServerStorage } from './storage';
import { SimpleFetch } from './common/request';
import { JupyterHubUrlCapture } from './urlCapture';
import { Authenticator } from './authenticator';
import { deleteApiToken, getUserJupyterUrl } from './jupyterHubApi';
import { noop } from './common/utils';
import { IJupyterHubConnectionValidator } from './types';
import { JupyterHubConnectionValidator } from './validator';

export const UserJupyterServerUriListKey = 'user-jupyter-server-uri-list';
export const UserJupyterServerUriListKeyV2 = 'user-jupyter-server-uri-list-version2';
export const UserJupyterServerUriListMementoKey = '_builtin.jupyterServerUrlProvider.uriList';

export class JupyterServerIntegration implements JupyterServerProvider, JupyterServerCommandProvider {
    readonly id: string = 'UserJupyterServerPickerProviderId';
    readonly documentation = Uri.parse('https://aka.ms/vscodeJuptyerExtKernelPickerExistingServer');
    private readonly newAuthenticator: Authenticator;
    private readonly disposables: Disposable[] = [];
    private readonly _onDidChangeServers = new EventEmitter<void>();
    public readonly onDidChangeServers = this._onDidChangeServers.event;
    private previouslyEnteredUrlTypedIntoQuickPick?: string;
    private previouslyEnteredJupyterServerBasedOnUrlTypedIntoQuickPick?: JupyterServer;
    private readonly jupyterConnectionValidator: IJupyterHubConnectionValidator;
    constructor(
        private readonly fetch: SimpleFetch,
        private readonly jupyterApi: Jupyter,
        private readonly storage: JupyterHubServerStorage,
        private readonly urlCapture: JupyterHubUrlCapture,
        private readonly nodeFetchImpl: typeof nodeFetch = nodeFetch
    ) {
        this.jupyterConnectionValidator = new JupyterHubConnectionValidator(fetch);
        this.newAuthenticator = new Authenticator(fetch);
        const collection = this.jupyterApi.createJupyterServerCollection(
            this.id,
            Localized.KernelActionSourceTitle,
            this
        );
        this.disposables.push(collection);
        this.disposables.push(this._onDidChangeServers);
        collection.commandProvider = this;
        collection.documentation = Uri.parse('https://aka.ms/vscodeJupyterHub');
    }
    public dispose() {
        dispose(this.disposables);
    }
    public async handleCommand(
        command: JupyterServerCommand & { url?: string },
        token: CancellationToken
    ): Promise<JupyterServer | undefined> {
        try {
            const url = 'url' in command ? command.url : undefined;

            // Its possible this command was executed as a result of hitting the back button.
            // When we provide a url we skip the url capture input box, but when we come here from the
            // back button then we need to re-display the url capture input box.
            let displayName: string | undefined = undefined;
            let serverId: string | undefined = undefined;
            let whyCaptureUrl: 'cameHereFromBackButton' | 'captureNewUrl' = 'captureNewUrl';
            if (
                url &&
                this.previouslyEnteredUrlTypedIntoQuickPick === url &&
                this.previouslyEnteredJupyterServerBasedOnUrlTypedIntoQuickPick
            ) {
                whyCaptureUrl = 'cameHereFromBackButton';
                serverId = this.previouslyEnteredJupyterServerBasedOnUrlTypedIntoQuickPick.id;
                displayName = this.previouslyEnteredJupyterServerBasedOnUrlTypedIntoQuickPick.label;
            }
            const server = await this.urlCapture.captureRemoteJupyterUrl(
                token,
                url,
                displayName,
                undefined,
                serverId,
                whyCaptureUrl
            );
            if (!server) {
                this.previouslyEnteredJupyterServerBasedOnUrlTypedIntoQuickPick = undefined;
                this.previouslyEnteredUrlTypedIntoQuickPick = undefined;
                return;
            }
            this._onDidChangeServers.fire();
            this.previouslyEnteredJupyterServerBasedOnUrlTypedIntoQuickPick = server;
            return server;
        } catch (ex) {
            if (!(ex instanceof CancellationError)) {
                traceError(`Failed to select a Jupyter Server`, ex);
            }
            this.previouslyEnteredUrlTypedIntoQuickPick = undefined;
            this.previouslyEnteredJupyterServerBasedOnUrlTypedIntoQuickPick = undefined;
            throw ex;
        }
    }
    /**
     * @param value Value entered by the user in the quick pick
     */
    async provideCommands(value: string, _token: CancellationToken): Promise<JupyterServerCommand[]> {
        this.previouslyEnteredJupyterServerBasedOnUrlTypedIntoQuickPick = undefined;
        this.previouslyEnteredUrlTypedIntoQuickPick = undefined;
        let url = '';
        try {
            value = (value || '').trim();
            if (['http:', 'https:'].includes(new URL(value.trim()).protocol.toLowerCase())) {
                url = value;
            }
        } catch {
            //
        }
        if (url) {
            this.previouslyEnteredUrlTypedIntoQuickPick = url;
            const label = Localized.connectToToTheJupyterServer(url);
            return [{ label, url } as JupyterServerCommand];
        }
        return [{ label: Localized.labelOfCommandToEnterUrl, canBeAutoSelected: true }];
    }
    async removeJupyterServer?(server: JupyterServer): Promise<void> {
        const tokenSource = new CancellationTokenSource();
        try {
            const serverInfo = this.storage.all.find((s) => s.id === server.id);
            const authInfo = await this.storage.getCredentials(server.id).catch(noop);
            if (serverInfo && authInfo?.token && authInfo.tokenId) {
                // Delete the token that we created (we no longer need this).
                await deleteApiToken(
                    serverInfo.baseUrl,
                    authInfo.username,
                    authInfo.tokenId,
                    authInfo.token,
                    this.fetch,
                    tokenSource.token
                ).catch((ex) => traceDebug(`Failed to delete token ${server.id}`, ex));
            }
            await this.storage.removeServer(server.id);
        } catch (ex) {
            traceDebug(`Failed to remove server ${server.id}`, ex);
        } finally {
            this._onDidChangeServers.fire();
        }
    }
    async provideJupyterServers(_token: CancellationToken): Promise<JupyterServer[]> {
        return this.storage.all.map((s) => {
            return {
                id: s.id,
                label: s.displayName
            };
        });
    }
    private cachedOfAuthInfo = new Map<string, Promise<JupyterServer>>();
    public async resolveJupyterServer(server: JupyterServer, token: CancellationToken): Promise<JupyterServer> {
        if (!this.cachedOfAuthInfo.get(server.id)) {
            const promise = this.resolveJupyterServerImpl(server, token);
            promise.catch((ex) => {
                if (this.cachedOfAuthInfo.get(server.id) === promise) {
                    traceError(`Failed to get auth information for server ${server.id}`, ex);
                    this.cachedOfAuthInfo.delete(server.id);
                }
            });
            this.cachedOfAuthInfo.set(server.id, promise);
        }
        return this.cachedOfAuthInfo.get(server.id)!;
    }
    private async resolveJupyterServerImpl(
        server: JupyterServer,
        cancelToken: CancellationToken
    ): Promise<JupyterServer> {
        const serverInfo = this.storage.all.find((s) => s.id === server.id);
        if (!serverInfo) {
            throw new Error('Server not found');
        }
        const authInfo = await this.storage.getCredentials(server.id);
        if (!authInfo) {
            throw new Error(`Server ${server.id} not found`);
        }

        // Verify the server is running, if not start this server.
        const result = await this.newAuthenticator.getJupyterAuthInfo(
            { baseUrl: serverInfo.baseUrl, authInfo },
            cancelToken
        );

        if (result.tokenId && authInfo?.token !== result.token) {
            // If we have ended up with a new token, (happens if th old token expired)
            // Then save the updated token information.
            try {
                await this.storage.addServerOrUpdate(
                    {
                        baseUrl: serverInfo.baseUrl,
                        displayName: serverInfo.displayName,
                        id: serverInfo.id
                    },
                    {
                        password: authInfo.password || '',
                        username: authInfo.username || '',
                        token: result.token,
                        tokenId: result.tokenId
                    }
                );
            } catch (ex) {
                traceError(`Failed to update server with the latest token information ${server.id}`, ex);
            }
        }

        // Ensure the server is running.
        // Else nothing will work when attempting to connect to this server from Jupyter Extension.
        await this.jupyterConnectionValidator
            .validateJupyterUri(
                serverInfo.baseUrl,
                { username: authInfo.username, password: authInfo.password, token: result.token },
                this.newAuthenticator,
                cancelToken
            )
            .catch(noop);

        const rawBaseUrl = await getUserJupyterUrl(
            serverInfo.baseUrl,
            authInfo.username || '',
            authInfo.token,
            this.fetch,
            cancelToken
        );

        // https://github.com/microsoft/vscode-jupyter-hub/issues/53
        const baseUrl = Uri.parse(rawBaseUrl);
        const brokenUrl = new this.nodeFetchImpl.Request(baseUrl.toString(true)).url;
        const correctUrl = new this.nodeFetchImpl.Request(rawBaseUrl).url;
        const brokenWsUrl = brokenUrl.replace('http', 'ws');
        const brokenWsUrl2 = baseUrl.toString(true).replace('http', 'ws');
        const correctWsUrl = correctUrl.replace('http', 'ws');
        const ourFetch = async (input: Request, init?: RequestInit) => {
            const newUrl = input.url.replace(brokenUrl, correctUrl);
            init = init || {
                method: input.method,
                body: input.body,
                headers: input.headers,
                redirect: input.redirect,
                cache: input.cache,
                credentials: input.credentials,
                integrity: input.integrity,
                keepalive: input.keepalive,
                mode: input.mode,
                referrer: input.referrer,
                referrerPolicy: input.referrerPolicy,
                signal: input.signal
            };
            const newInput = new this.nodeFetchImpl.Request(newUrl, init as any);
            return this.nodeFetchImpl.default(newInput as any, init as any);
        };
        class OurWebSocket extends WebSocketIsomorphic {
            constructor(url: string, protocols?: string | string[]) {
                super(url.replace(brokenWsUrl, correctWsUrl).replace(brokenWsUrl2, correctWsUrl), protocols);
            }
        }
        return {
            ...server,
            connectionInformation: {
                baseUrl,
                token: result.token,
                fetch: ourFetch as any,
                WebSocket: OurWebSocket
            } as any
        };
    }
}
