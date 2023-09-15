// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocketIsomorphic from 'isomorphic-ws';
import { ClassType } from '../../common/types';
import { KernelSocketWrapper } from './kernelSocketWrapper';
import { traceError } from '../../common/logging';
import { noop } from '../../common/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
const JupyterWebSockets = new Map<string, WebSocketIsomorphic>(); // NOSONAR

// Function for creating node Request object that prevents jupyterlab services from writing its own
// authorization header.
export function getWebsocketCtor(
    cookieString?: string,
    allowUnauthorized?: boolean,
    getAuthHeaders?: () => Record<string, string>,
    getWebSocketProtocols?: () => string | string[] | undefined
): ClassType<WebSocket> {
    const generateOptions = (): WebSocketIsomorphic.ClientOptions => {
        let co: WebSocketIsomorphic.ClientOptions = {};
        let co_headers: { [key: string]: string } | undefined;

        if (allowUnauthorized) {
            co = { ...co, rejectUnauthorized: false };
        }

        if (cookieString) {
            co_headers = { Cookie: cookieString };
        }

        // Auth headers have to be refetched every time we create a connection. They may have expired
        // since the last connection.
        if (getAuthHeaders) {
            const authorizationHeader = getAuthHeaders();
            co_headers = co_headers ? { ...co_headers, ...authorizationHeader } : authorizationHeader;
        }
        if (co_headers) {
            co = { ...co, headers: co_headers };
        }
        return co;
    };
    const getProtocols = (protocols?: string | string[]): string | string[] | undefined => {
        const authProtocols = getWebSocketProtocols ? getWebSocketProtocols() : undefined;
        if (!authProtocols && !protocols) {
            return;
        }
        if (!protocols && authProtocols) {
            return authProtocols;
        }
        if (protocols && !authProtocols) {
            return protocols;
        }
        protocols = !protocols ? [] : typeof protocols === 'string' ? [protocols] : protocols;
        if (Array.isArray(authProtocols)) {
            protocols.push(...authProtocols);
        } else if (typeof authProtocols === 'string') {
            protocols.push(authProtocols);
        }
        return protocols;
    };
    class JupyterWebSocket extends KernelSocketWrapper(WebSocketIsomorphic) {
        private kernelId: string | undefined;
        private timer: NodeJS.Timeout | number;

        constructor(url: string, protocols?: string | string[] | undefined) {
            super(url, getProtocols(protocols), generateOptions());
            let timer: NodeJS.Timeout | undefined = undefined;
            // Parse the url for the kernel id
            const parsed = /.*\/kernels\/(.*)\/.*/.exec(url);
            if (parsed && parsed.length > 1) {
                this.kernelId = parsed[1];
            }
            if (this.kernelId) {
                JupyterWebSockets.set(this.kernelId, this);
                this.on('close', () => {
                    if (timer && this.timer !== timer) {
                        clearInterval(timer as any);
                    }
                    if (JupyterWebSockets.get(this.kernelId!) === this) {
                        JupyterWebSockets.delete(this.kernelId!);
                    }
                });
            } else {
                traceError('KernelId not extracted from Kernel WebSocket URL');
            }

            // Ping the websocket connection every 30 seconds to make sure it stays alive
            timer = this.timer = setInterval(() => this.ping(noop), 30_000);
        }
    }
    return JupyterWebSocket as any;
}
