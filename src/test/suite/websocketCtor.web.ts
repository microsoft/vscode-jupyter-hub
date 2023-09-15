// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocketIsomorphic from 'isomorphic-ws';
import { KernelSocketWrapper } from './kernelSocketWrapper';
import { traceError } from '../../common/logging';

const JupyterWebSockets = new Map<string, WebSocketIsomorphic>(); // NOSONAR

// Function for creating node Request object that prevents jupyterlab services from writing its own
// authorization header.
export function getWebsocketCtor(
    _cookieString?: string,
    _allowUnauthorized?: boolean,
    _getAuthHeaders?: () => Record<string, string>,
    getWebSocketProtocols?: () => string | string[] | undefined
) {
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
        private timer: NodeJS.Timeout | number = 0;
        private boundOpenHandler = this.openHandler.bind(this);

        constructor(url: string, protocols?: string | string[] | undefined) {
            super(url, getProtocols(protocols));
            let timer: NodeJS.Timeout | undefined = undefined;
            // Parse the url for the kernel id
            const parsed = /.*\/kernels\/(.*)\/.*/.exec(url);
            if (parsed && parsed.length > 1) {
                this.kernelId = parsed[1];
            }
            if (this.kernelId) {
                JupyterWebSockets.set(this.kernelId, this);
                this.onclose = () => {
                    if (timer && this.timer !== timer) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        clearInterval(timer as any);
                    }
                    if (JupyterWebSockets.get(this.kernelId!) === this) {
                        JupyterWebSockets.delete(this.kernelId!);
                    }
                };
            } else {
                traceError('KernelId not extracted from Kernel WebSocket URL');
            }

            // TODO: Implement ping. Well actually see if ping is necessary
            // Ping the websocket connection every 30 seconds to make sure it stays alive
            //timer = this.timer = setInterval(() => this.ping(), 30_000);

            // On open, replace the onmessage handler with our own.
            this.addEventListener('open', this.boundOpenHandler);
        }

        private openHandler() {
            // Node version uses emit override to handle messages before they go to jupyter (and pause messages)
            // We need a workaround. There is no 'emit' on websockets for the web so we have to create one.
            const originalMessageHandler = this.onmessage;

            // We do this by replacing the set onmessage (set by jupyterlabs) with our
            // own version
            this.onmessage = (ev) => {
                this.handleEvent(
                    (ev, ...args) => {
                        const event: WebSocketIsomorphic.MessageEvent = {
                            data: args[0],
                            type: ev.toString(),
                            target: this
                        };
                        originalMessageHandler(event);
                        return true;
                    },
                    'message',
                    ev.data
                );
            };

            this.removeEventListener('open', this.boundOpenHandler);
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return JupyterWebSocket as any;
}
