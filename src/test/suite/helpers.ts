// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { extensions } from 'vscode';
import { EXTENSION_ID } from '../../common/constants';
import { ClassImplementationsForTests } from '../../testUtils';
import { ClassType } from '../../common/types';

export async function activateHubExtension() {
    const ext = extensions.getExtension(EXTENSION_ID);
    if (!ext) {
        throw new Error('JupyterHub extension not installed');
    }
    if (!ext.isActive) {
        await ext.activate();
    }
    return Promise.resolve(ext.exports as ClassImplementationsForTests);
}

type WebSocketCtor = (
    cookieString?: string,
    allowUnauthorized?: boolean,
    getAuthHeaders?: () => Record<string, string>,
    getWebSocketProtocols?: () => string | string[] | undefined
) => ClassType<WebSocket>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let webSocketCtor: WebSocketCtor = undefined as any;
export function setWebSocketCreator(creator: WebSocketCtor) {
    webSocketCtor = creator;
}
export function getWebSocketCreator() {
    return webSocketCtor;
}
