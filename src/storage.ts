// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento, SecretStorage } from 'vscode';
import { traceError } from './common/logging';
import { DisposableStore } from './common/lifecycle';
import { IJupyterHubServerStorage, JupyterHubAuthInfo, JupyterHubAuthKind, JupyterHubServer } from './types';

const serverListStorageKey = 'JupyterHubServers';
const AuthKeyPrefix = 'JupyterHubServerAuthInfo_';
function getAuthInfoKey(serverId: string) {
    return `${AuthKeyPrefix}${serverId}`;
}
type Credentials = JupyterHubAuthInfo;

function getAuthKind(auth: Partial<JupyterHubAuthInfo>): JupyterHubAuthKind {
    if (auth.authKind) {
        return auth.authKind;
    }
    if (auth.password) {
        return 'password';
    }
    if (auth.token) {
        return 'token';
    }
    return 'password';
}

function normalizeCredentials(auth: Partial<JupyterHubAuthInfo>): Credentials {
    return {
        authKind: getAuthKind(auth),
        username: auth.username || '',
        password: auth.password || '',
        token: auth.token || '',
        tokenId: auth.tokenId || ''
    };
}

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
    public get all(): JupyterHubServer[] {
        return this.globalMemento.get<JupyterHubServer[]>(serverListStorageKey, []);
    }
    public async getCredentials(serverId: string): Promise<JupyterHubAuthInfo | undefined> {
        try {
            const js = await this.secrets.get(getAuthInfoKey(serverId));
            if (!js) {
                return;
            }
            return normalizeCredentials(JSON.parse(js || '') as Partial<Credentials>);
        } catch (ex) {
            traceError(`Failed to extract stored username/password ${serverId}`);
            return;
        }
    }
    public async addServerOrUpdate(
        server: { id: string; baseUrl: string; displayName: string; serverName: string | undefined },
        auth: JupyterHubAuthInfo
    ) {
        const normalizedAuth = normalizeCredentials(auth);
        await Promise.all([
            this.globalMemento.update(serverListStorageKey, this.all.filter((s) => s.id !== server.id).concat(server)),
            this.secrets.store(getAuthInfoKey(server.id), JSON.stringify(normalizedAuth))
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
