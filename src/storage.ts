// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento, SecretStorage } from 'vscode';
import { traceError } from './common/logging';
import { DisposableStore } from './common/lifecycle';
import { IJupyterHubServerStorage, JupyterHubServer } from './types';

const serverListStorageKey = 'JupyterHubServers';
const AuthKeyPrefix = 'JupyterHubServerAuthInfo_';
function getAuthInfoKey(serverId: string) {
    return `${AuthKeyPrefix}${serverId}`;
}
type Credentials = {
    username: string;
    password: string; // Required to re-generate the token.
    token: string; // Generated using Hub REST API, this api token is used for connecting to Jupyter by Jupyter Extension.
    tokenId: string; // Requried when we want to delete the token using the Hub REST API.
};

export class JupyterHubServerStorage implements IJupyterHubServerStorage {
    private disposable = new DisposableStore();
    _onDidRemove = new EventEmitter<JupyterHubServer>();
    onDidRemove = this._onDidRemove.event;
    constructor(
        private readonly secrets: SecretStorage,
        private readonly globalMemento: Memento
    ) {}
    dispose() {
        this.disposable.dispose();
    }
    public get all(): {
        id: string;
        baseUrl: string;
        displayName: string;
    }[] {
        return this.globalMemento.get<JupyterHubServer[]>(serverListStorageKey, []);
    }
    public async getCredentials(
        serverId: string
    ): Promise<{ username: string; password: string; token: string; tokenId: string } | undefined> {
        try {
            const js = await this.secrets.get(getAuthInfoKey(serverId));
            if (!js) {
                return;
            }
            return JSON.parse(js || '') as Credentials;
        } catch (ex) {
            traceError(`Failed to extract stored username/password ${serverId}`);
            return;
        }
    }
    public async addServerOrUpdate(
        server: { id: string; baseUrl: string; displayName: string },
        auth: { username: string; password: string; token: string; tokenId: string }
    ) {
        await Promise.all([
            this.globalMemento.update(serverListStorageKey, this.all.filter((s) => s.id !== server.id).concat(server)),
            this.secrets.store(getAuthInfoKey(server.id), JSON.stringify(auth))
        ]);
    }
    public async removeServer(serverId: string) {
        const item = this.all.find((s) => s.id === serverId);
        await Promise.all([
            this.globalMemento.update(
                serverListStorageKey,
                this.all.filter((s) => s.id !== serverId)
            ),
            this.secrets.delete(getAuthInfoKey(serverId))
        ]);

        if (item) {
            this._onDidRemove.fire(item);
        }
    }
}
