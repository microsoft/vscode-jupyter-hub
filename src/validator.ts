// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KernelSpecManager, KernelManager, ServerConnection, SessionManager } from '@jupyterlab/services';
import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    ConfigurationTarget,
    Disposable,
    Progress,
    ProgressLocation,
    window
} from 'vscode';
import { raceCancellationError, raceTimeout, sleep } from './common/async';
import { traceDebug, traceError } from './common/logging';
import { DisposableStore, dispose } from './common/lifecycle';
import { IJupyterHubConnectionValidator } from './types';
import { workspace } from 'vscode';
import { Localized } from './common/localize';
import { SimpleFetch } from './common/request';
import { createServerConnectSettings, getUserInfo, startServer } from './jupyterHubApi';
import { IAuthenticator } from './types';
import { StopWatch } from './common/stopwatch';
import { ISpecModels } from '@jupyterlab/services/lib/kernelspec/restapi';
import { solveCertificateProblem } from './common/telemetry';

const TIMEOUT_FOR_SESSION_MANAGER_READY = 10_000;

export class JupyterHubConnectionValidator implements IJupyterHubConnectionValidator {
    constructor(private readonly fetch: SimpleFetch) {}
    async validateJupyterUri(
        baseUrl: string,
        authInfo: {
            username: string;
            password: string;
            token: string;
        },
        authenticator: IAuthenticator,
        mainCancel: CancellationToken
    ): Promise<void> {
        await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: Localized.ConnectingToJupyterServer,
                cancellable: true
            },
            async (progress, progressCancel) => {
                const disposable = new DisposableStore();
                const masterCancel = disposable.add(new CancellationTokenSource());
                const token = masterCancel.token;
                disposable.add(mainCancel.onCancellationRequested(() => masterCancel.cancel()));
                disposable.add(progressCancel.onCancellationRequested(() => masterCancel.cancel()));
                try {
                    // Check if the server is running.
                    const didStartServer = await this.startIfServerNotStarted(baseUrl, authInfo, progress, token).catch(
                        (ex) => traceError(`Failed to start server`, ex)
                    );
                    const started = new StopWatch();
                    // Get the auth information again, as the previously held auth information does not seem to work when starting a jupyter server
                    const jupyterAuth = await authenticator.getJupyterAuthInfo({ baseUrl, authInfo }, token);
                    if (!jupyterAuth) {
                        throw new Error('Failed to get Jupyter Auth Info');
                    }
                    let retries = 0;
                    while (true) {
                        // Attempt to list the running kernels. It will return empty if there are none, but will
                        // throw if can't connect.
                        const settings = createServerConnectSettings(
                            baseUrl,
                            { username: authInfo.username, token: jupyterAuth.token },
                            this.fetch.requestCreator
                        );
                        const gotKernelSpecs = await getKernelSpecs(settings, token);
                        if (gotKernelSpecs) {
                            return;
                        }
                        // If we started the Jupyter server, give it time to completely start up.
                        // Theres a delay in APIs responding to requests.
                        if (didStartServer == 'didStartServer') {
                            // Wait for the server to start.
                            await sleep(1000, token);
                            if (retries > 0 && started.elapsed > TIMEOUT_FOR_SESSION_MANAGER_READY) {
                                throw new Error('Failed to enumeration kernel Specs');
                            } else {
                                // Retry at least once before we give up.
                                retries += 1;
                                traceDebug(`Waiting for Jupyter Server to start ${baseUrl}`);
                                continue;
                            }
                        } else {
                            throw new Error('Failed to enumeration kernel Specs');
                        }
                    }
                } catch (err) {
                    if (isSelfCertsError(err)) {
                        const handled = await handleSelfCertsError(err.message);
                        if (handled) {
                            // Try again, there could be other errors.
                            return await this.validateJupyterUri(baseUrl, authInfo, authenticator, token);
                        }
                    } else if (isSelfCertsExpiredError(err)) {
                        const handled = await handleExpiredCertsError(err.message);
                        if (handled) {
                            // Try again, there could be other errors.
                            return await this.validateJupyterUri(baseUrl, authInfo, authenticator, token);
                        }
                    }
                    throw err;
                } finally {
                    disposable.dispose();
                }
            }
        );
    }
    /**
     * If the Jupyter (lab/notebook) server has not already been started, then start it.
     * This is required, else we cannot connect to it (after all without a Jupyter Server running, there's nothing to connect to)
     */
    private async startIfServerNotStarted(
        baseUrl: string,
        authInfo: {
            username: string;
            password: string;
            token: string;
        },
        progress: Progress<{
            message?: string | undefined;
            increment?: number | undefined;
        }>,
        token: CancellationToken
    ) {
        try {
            const status = await getUserInfo(baseUrl, authInfo.username, authInfo.token, this.fetch, token);
            if (status.server) {
                return;
            }
        } catch (ex) {
            traceError(`Failed to get user info`, ex);
            return;
        }
        progress.report({ message: Localized.startingJupyterServer });
        await startServer(baseUrl, authInfo.username, authInfo.token, this.fetch, token).catch((ex) =>
            ex instanceof CancellationError ? undefined : traceError(`Failed to start the Jupyter Server`, ex)
        );
        try {
            const started = Date.now();
            while (true) {
                const status = await getUserInfo(baseUrl, authInfo.username, authInfo.token, this.fetch, token);
                if (status.server) {
                    return 'didStartServer';
                }
                if (Date.now() - started > TIMEOUT_FOR_SESSION_MANAGER_READY) {
                    traceError(`Timeout waiting for Jupyter Server to start, current status = ${status.pending}`);
                    return;
                }
                await sleep(1000, token);
            }
        } catch (ex) {
            traceError(`Failed to get user info for user`, ex);
            return;
        }
    }
}

export async function getKernelSpecs(
    serverSettings: ServerConnection.ISettings,
    token: CancellationToken
): Promise<ISpecModels | null | undefined> {
    const specsManager = new KernelSpecManager({ serverSettings });
    const kernelManager = new KernelManager({ serverSettings });
    const sessionManager = new SessionManager({
        serverSettings,
        kernelManager: kernelManager
    });
    const disposables: Disposable[] = [];
    try {
        const hasKernelSpecs = () => specsManager.specs && Object.keys(specsManager.specs.kernelspecs).length > 0;
        // Fetch the list the session manager already knows about. Refreshing may not work or could be very slow.
        if (hasKernelSpecs()) {
            return specsManager.specs;
        }

        // Wait for the session to be ready
        await raceCancellationError(token, raceTimeout(TIMEOUT_FOR_SESSION_MANAGER_READY, sessionManager.ready));
        if (hasKernelSpecs()) {
            return specsManager.specs;
        }

        // Ask the session manager to refresh its list of kernel specs. This might never
        // come back so only wait for ten seconds (learnt this in Jupyter extension).
        await raceCancellationError(token, raceTimeout(TIMEOUT_FOR_SESSION_MANAGER_READY, specsManager.refreshSpecs()));
        if (hasKernelSpecs()) {
            return specsManager.specs;
        }

        // At this point wait for the specs to change
        const promise = new Promise<unknown>((resolve) => {
            specsManager.specsChanged.connect(resolve);
            disposables.push(
                new Disposable(() => {
                    try {
                        specsManager.specsChanged.disconnect(resolve);
                    } catch {}
                })
            );
        });

        await raceCancellationError(
            token,
            raceTimeout(
                TIMEOUT_FOR_SESSION_MANAGER_READY,
                promise,
                specsManager.ready,
                specsManager.refreshSpecs(),
                sessionManager.ready
            )
        );

        if (hasKernelSpecs()) {
            return specsManager.specs;
        }
        traceError(
            `SessionManager cannot enumerate kernelSpecs. Specs ${JSON.stringify(specsManager.specs?.kernelspecs)}.`
        );
        return;
    } catch (e) {
        if (!(e instanceof CancellationError)) {
            traceError(`SessionManager:getKernelSpecs failure: `, e);
        }
        return;
    } finally {
        dispose(disposables);
        try {
            // Make sure it finishes startup.
            await raceTimeout(10_000, sessionManager.ready);
        } catch (e) {
            traceError(`Exception on session manager shutdown: `, e);
        } finally {
            try {
                sessionManager.dispose();
            } catch {}
            try {
                kernelManager.dispose();
            } catch {}
            try {
                specsManager.dispose();
            } catch {}
        }
    }
}

/**
 * Error thrown when a jupyter server is using an self signed certificate. This can be expected and we should ask if they want to allow it anyway.
 *
 * Cause:
 * User is connecting to a server that is using a self signed certificate that is not trusted. Detected by looking for a specific error message when connecting.
 *
 * Handled by:
 * The URI entry box when picking a server. It should ask the user if they want to allow it anyway.
 */
export function isSelfCertsError(err: Error) {
    return err.message.indexOf('reason: self signed certificate') >= 0;
}
export async function handleSelfCertsError(message: string): Promise<boolean> {
    // On a self cert error, warn the user and ask if they want to change the setting
    const enableOption: string = Localized.jupyterSelfCertEnable;
    const closeOption: string = Localized.jupyterSelfCertClose;
    const value = await window.showErrorMessage(
        Localized.jupyterSelfCertFail(message),
        { modal: true },
        enableOption,
        closeOption
    );
    if (value === enableOption) {
        solveCertificateProblem('self-signed', 'allow');
        await workspace
            .getConfiguration('jupyter')
            .update('allowUnauthorizedRemoteConnection', true, ConfigurationTarget.Workspace);
        return true;
    } else {
        solveCertificateProblem('self-signed', 'cancel');
    }
    return false;
}

/**
 * Error thrown when a jupyter server is using a self signed expired certificate. This can be expected and we should ask if they want to allow it anyway.
 *
 * Cause:
 * User is connecting to a server that is using a self signed certificate that is expired. Detected by looking for a specific error message when connecting.
 *
 * Handled by:
 * The URI entry box when picking a server. It should ask the user if they want to allow it anyway.
 */
export function isSelfCertsExpiredError(err: Error) {
    return err.message.indexOf('reason: certificate has expired') >= 0;
}
export async function handleExpiredCertsError(message: string): Promise<boolean> {
    // On a self cert error, warn the user and ask if they want to change the setting
    const enableOption: string = Localized.jupyterSelfCertEnable;
    const closeOption: string = Localized.jupyterSelfCertClose;
    const value = await window.showErrorMessage(
        Localized.jupyterExpiredCertFail(message),
        { modal: true },
        enableOption,
        closeOption
    );
    if (value === enableOption) {
        solveCertificateProblem('expired', 'allow');
        await workspace
            .getConfiguration('jupyter')
            .update('allowUnauthorizedRemoteConnection', true, ConfigurationTarget.Workspace);
        return true;
    } else {
        solveCertificateProblem('expired', 'cancel');
    }
    return false;
}
