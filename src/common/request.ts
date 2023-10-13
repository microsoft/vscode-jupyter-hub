// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, ConfigurationTarget, window, workspace } from 'vscode';
import { IJupyterRequestCreator } from '../types';
import { Localized } from './localize';
import { raceCancellationError } from './async';
import { solveCertificateProblem } from './telemetry';
import { traceError } from './logging';

/**
 * Responsible for intercepting connections to a remote server and asking for a password if necessary
 */
export class SimpleFetch {
    constructor(public readonly requestCreator: IJupyterRequestCreator) {}

    public async send(url: string, options: RequestInit, token: CancellationToken): Promise<Response> {
        const allowUnauthorized = workspace
            .getConfiguration('jupyter')
            .get<boolean>('allowUnauthorizedRemoteConnection', false);

        // Try once and see if it fails with unauthorized.
        try {
            return await raceCancellationError(
                token,
                this.requestCreator.getFetchMethod()(url, this.addAllowUnauthorized(url, allowUnauthorized, options))
            );
        } catch (e) {
            traceError(`Error sending request to ${url}`, e);
            if (e.message.indexOf('reason: self signed certificate') >= 0) {
                // Ask user to change setting and possibly try again.
                const value = await window.showErrorMessage(
                    Localized.jupyterSelfCertFail(e.message),
                    { modal: true },
                    Localized.jupyterSelfCertEnable,
                    Localized.jupyterSelfCertClose
                );
                if (value === Localized.jupyterSelfCertEnable) {
                    solveCertificateProblem('self-signed', 'allow');
                    await workspace
                        .getConfiguration('jupyter')
                        .updateSetting(
                            'allowUnauthorizedRemoteConnection',
                            true,
                            undefined,
                            ConfigurationTarget.Workspace
                        );
                    // Now that we have fixed the error, lets try to send the request again.
                    return this.requestCreator.getFetchMethod()(url, this.addAllowUnauthorized(url, true, options));
                } else if (value === Localized.jupyterSelfCertClose) {
                    solveCertificateProblem('self-signed', 'cancel');
                }
            }
            throw e;
        }
    }

    /**
     * For HTTPS connections respect our allowUnauthorized setting by adding in an agent to enable that on the request
     */
    private addAllowUnauthorized(url: string, allowUnauthorized: boolean, options: RequestInit): RequestInit {
        if (url.startsWith('https') && allowUnauthorized && this.requestCreator.createHttpRequestAgent) {
            const requestAgent = this.requestCreator.createHttpRequestAgent();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return { ...options, agent: requestAgent } as any;
        }

        return options;
    }
}
