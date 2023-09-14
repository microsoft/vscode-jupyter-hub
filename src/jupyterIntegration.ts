// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { CancellationError, CancellationToken, Disposable, EventEmitter, Uri } from 'vscode';
import type { Jupyter, JupyterServer, JupyterServerCommand } from '@vscode/jupyter-extension';
import { Localized } from './common/localize';
import { traceError } from './common/logging';
import { dispose } from './common/lifecycle';
import { JupyterHubServerStorage } from './storage';
import { SimpleFetch } from './common/request';
import { JupyterHubUrlCapture } from './urlCapture';
import { BaseCookieStore } from './common/cookieStore.base';
import { ClassType } from './common/types';
import { NewAuthenticator } from './authenticators/authenticator';
import { OldUserNamePasswordAuthenticator } from './authenticators/passwordConnect';
import { IAuthenticator } from './authenticators/types';
import { getJupyterUrl } from './jupyterHubApi';

export const UserJupyterServerUriListKey = 'user-jupyter-server-uri-list';
export const UserJupyterServerUriListKeyV2 = 'user-jupyter-server-uri-list-version2';
export const UserJupyterServerUriListMementoKey = '_builtin.jupyterServerUrlProvider.uriList';

export class JupyterServerIntegration {
    readonly id: string = 'UserJupyterServerPickerProviderId';
    public readonly extensionId: string = 'JVSC_EXTENSION_ID';
    readonly documentation = Uri.parse('https://aka.ms/vscodeJuptyerExtKernelPickerExistingServer');
    private readonly oldAuthenticator: OldUserNamePasswordAuthenticator;
    private readonly newAuthenticator: NewAuthenticator;
    private readonly disposables: Disposable[] = [];
    private readonly _onDidChangeServers = new EventEmitter<void>();
    public readonly onDidChangeServers = this._onDidChangeServers.event;
    private previouslyEnteredUrlTypedIntoQuickPick?: string;
    private previouslyEnteredJupyterServerBasedOnUrlTypedIntoQuickPick?: JupyterServer;
    public get commands(): JupyterServerCommand[] {
        return [{ label: Localized.labelOfCommandToEnterUrl }];
    }
    constructor(
        fetch: SimpleFetch,
        private readonly jupyterApi: Jupyter,
        private readonly storage: JupyterHubServerStorage,
        private readonly urlCapture: JupyterHubUrlCapture,
        CookieStore: ClassType<BaseCookieStore>
    ) {
        this.oldAuthenticator = new OldUserNamePasswordAuthenticator(fetch);
        this.disposables.push(this.oldAuthenticator);
        this.newAuthenticator = new NewAuthenticator(fetch, CookieStore);
        this.disposables.push(this.newAuthenticator);

        const collection = this.jupyterApi.createJupyterServerCollection(
            this.id,
            Localized.KernelActionSourceTitle,
            this
        );
        this.disposables.push(collection);
        this.disposables.push(this._onDidChangeServers);
        collection.commandProvider = this;
        collection.documentation = Uri.parse(
            'https://code.visualstudio.com/docs/datascience/jupyter-kernel-management#_existing-jupyter-server'
        );
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
        return [{ label: Localized.labelOfCommandToEnterUrl }];
    }
    async removeJupyterServer?(server: JupyterServer): Promise<void> {
        await this.storage.removeServer(server.id);
        this._onDidChangeServers.fire();
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
    public async resolveJupyterServerImpl(server: JupyterServer, token: CancellationToken): Promise<JupyterServer> {
        const serverInfo = this.storage.all.find((s) => s.id === server.id);
        if (!serverInfo) {
            throw new Error('Server not found');
        }
        const authInfo = await this.storage.getCredentials(server.id);
        const authenticator: IAuthenticator =
            serverInfo.authProvider === 'old' ? this.oldAuthenticator : this.newAuthenticator;
        const result = await authenticator.getJupyterAuthInfo(
            {
                baseUrl: serverInfo.baseUrl,
                authInfo: {
                    username: authInfo?.username || '',
                    password: authInfo?.password || ''
                }
            },
            token
        );

        return {
            ...server,
            connectionInformation: {
                baseUrl: Uri.parse(getJupyterUrl(serverInfo.baseUrl, authInfo?.username || '')),
                token: result?.token,
                headers: result?.headers
            }
        };
    }
}
