// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Agent } from 'https';
import * as nodeFetch from 'node-fetch';
import { IJupyterRequestCreator } from '../types';
import { ClassType } from './types';

// Function for creating node Request object that prevents jupyterlab services from writing its own
// authorization header.
/* eslint-disable @typescript-eslint/no-explicit-any */
export class JupyterRequestCreator implements IJupyterRequestCreator {
    public getRequestCtor(getAuthHeader?: () => any) {
        // Only need the authorizing part. Cookie and rejectUnauthorized are set in the websocket ctor for node.
        class AuthorizingRequest extends nodeFetch.Request {
            constructor(input: nodeFetch.RequestInfo, init?: nodeFetch.RequestInit) {
                super(input, init);

                // Add all of the authorization parts onto the headers.
                const origHeaders = this.headers;
                const authorizationHeader = getAuthHeader?.() || {};
                const keys = Object.keys(authorizationHeader);
                keys.forEach((k) => origHeaders.append(k, authorizationHeader[k].toString()));
                origHeaders.set('Content-Type', 'application/json');

                // Rewrite the 'append' method for the headers to disallow 'authorization' after this point
                const origAppend = origHeaders.append.bind(origHeaders);
                origHeaders.append = (k, v) => {
                    if (k.toLowerCase() !== 'authorization') {
                        origAppend(k, v);
                    }
                };
            }
        }

        return (
            getAuthHeader && Object.keys(getAuthHeader() || {}).length ? AuthorizingRequest : nodeFetch.Request
        ) as any;
    }

    public getFetchMethod(): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
        return nodeFetch.default as any;
    }

    public getHeadersCtor(): ClassType<Headers> {
        return nodeFetch.Headers as any;
    }

    public getRequestInit(): RequestInit {
        return { cache: 'no-store', credentials: 'same-origin' };
    }

    public createHttpRequestAgent() {
        return new Agent({ rejectUnauthorized: false }); // CodeQL [SM03616] User has been prompted at this point whether to allow making requests to http servers with invalid certificates.
    }
}
