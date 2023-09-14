// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IJupyterRequestCreator } from '../types';
import { ClassType } from './types';

// Function for creating node Request object that prevents jupyterlab services from writing its own
// authorization header.
export class JupyterRequestCreator implements IJupyterRequestCreator {
    public getRequestCtor(getAuthHeaders?: () => Record<string, string>) {
        class AuthorizingRequest extends Request {
            constructor(input: RequestInfo, init?: RequestInit) {
                super(input, init);

                // Add all of the authorization parts onto the headers.
                const origHeaders = this.headers;

                if (getAuthHeaders) {
                    const authorizationHeader = getAuthHeaders();
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
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (getAuthHeaders && Object.keys(getAuthHeaders() || {}).length ? AuthorizingRequest : Request) as any;
    }

    public getFetchMethod(): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
        return fetch;
    }

    public getHeadersCtor(): ClassType<Headers> {
        return Headers;
    }

    public getRequestInit(): RequestInit {
        return { cache: 'no-store' };
    }
}
