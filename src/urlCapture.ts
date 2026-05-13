// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationError,
    CancellationToken,
    QuickInputButton,
    ThemeIcon,
    Uri,
    env,
    l10n,
    type QuickPickItem
} from 'vscode';
import type { JupyterServer } from '@vscode/jupyter-extension';
import { Localized } from './common/localize';
import { noop, uuid } from './common/utils';
import { traceDebug, traceError, traceWarn } from './common/logging';
import { DisposableStore, dispose } from './common/lifecycle';
import { JupyterHubConnectionValidator, isSelfCertsError, isSelfCertsExpiredError } from './validator';
import { WorkflowInputCapture } from './common/inputCapture';
import { JupyterHubServerStorage } from './storage';
import { SimpleFetch } from './common/request';
import {
    IAuthenticator,
    ITmpAuthenticatorBootstrapper,
    JupyterHubAuthInfo,
    JupyterHubMissingUsernameError
} from './types';
import { Authenticator } from './authenticator';
import {
    extractTokenFromUrl,
    extractUserNameFromUrl,
    getJupyterHubBaseUrl,
    getVersion,
    listServers,
    type ApiTypes
} from './jupyterHubApi';
import { appendUrlPath, isWebExtension } from './utils';
import { sendJupyterHubUrlAdded, sendJupyterHubUrlNotAdded } from './common/telemetry';

export class JupyterHubUrlCapture {
    private readonly jupyterConnection: JupyterHubConnectionValidator;
    private readonly displayNamesOfHandles = new Map<string, string>();
    private readonly newAuthenticator: Authenticator;
    private readonly disposable = new DisposableStore();
    constructor(
        private readonly fetch: SimpleFetch,
        private readonly storage: JupyterHubServerStorage,
        private readonly tmpAuthBootstrapper?: ITmpAuthenticatorBootstrapper
    ) {
        this.newAuthenticator = new Authenticator(fetch, tmpAuthBootstrapper);
        this.jupyterConnection = new JupyterHubConnectionValidator(fetch);
    }
    dispose() {
        this.disposable.dispose();
    }
    public async captureRemoteJupyterUrl(
        token: CancellationToken,
        initialUrl: string = '',
        displayName: string = '',
        validationErrorMessage: string = '',
        serverId = uuid(),
        reasonForCapture: 'cameHereFromBackButton' | 'captureNewUrl' = 'captureNewUrl'
    ): Promise<JupyterServer | undefined> {
        try {
            return await this.captureRemoteJupyterUrlImpl(
                initialUrl,
                displayName,
                validationErrorMessage,
                serverId,
                reasonForCapture,
                token
            );
        } catch (ex) {
            if (!(ex instanceof CancellationError)) {
                traceError('Failed to capture remote jupyter server', ex);
            }
            throw ex;
        }
    }
    private async captureRemoteJupyterUrlImpl(
        url: string = '',
        displayName: string = '',
        validationErrorMessage: string = '',
        id = uuid(),
        reasonForCapture: 'cameHereFromBackButton' | 'captureNewUrl' = 'captureNewUrl',
        token: CancellationToken
    ): Promise<JupyterServer | undefined> {
        const state: State = {
            auth: { authKind: 'password', username: '', password: '', token: '', tokenId: '' },
            baseUrl: '',
            serverName: undefined,
            hubVersion: '',
            urlWasPrePopulated: false,
            url,
            displayName,
            displayNamesOfHandles: this.displayNamesOfHandles,
            errorMessage: validationErrorMessage,
            serverId: id
        };
        const steps: MultiStep<Step, State>[] = [
            new GetUrlStep(this.fetch),
            new GetCredentials(this.tmpAuthBootstrapper),
            new GetUserName(),
            new VerifyConnection(this.jupyterConnection, this.newAuthenticator),
            new ServerSelector(this.fetch),
            new GetDisplayName(this.storage)
        ];
        const disposables = new DisposableStore();
        let nextStep: Step | undefined = 'Get Url';
        if (url) {
            // Validate the URI first, which would otherwise be validated when user enters the Uri into the input box.
            if (isValidUrl(url)) {
                try {
                    state.baseUrl = await getJupyterHubBaseUrl(url, this.fetch, token);
                    const version = await getVersion(state.baseUrl, this.fetch, token);
                    state.hubVersion = version;
                    state.urlWasPrePopulated = true;
                    nextStep = reasonForCapture === 'captureNewUrl' ? 'Get Credentials' : 'Get Url';
                } catch {
                    validationErrorMessage = Localized.invalidJupyterHubUrl;
                }
            } else {
                // Uri has an error, show the error message by displaying the input box and pre-populating the url.
                validationErrorMessage = Localized.jupyterSelectURIInvalidURI;
                nextStep = 'Get Url';
            }
        }
        try {
            const stepsExecuted: Step[] = [];
            while (true) {
                const step = steps.filter((s) => !s.disabled).find((s) => s.step === nextStep);
                if (!step) {
                    traceError(`Step '${nextStep}' Not found`);
                    throw new CancellationError();
                }
                nextStep = await step.run(state, token);
                if (nextStep === 'Before') {
                    sendJupyterHubUrlNotAdded('back', step.step);
                    return;
                }
                if (nextStep === 'After') {
                    sendJupyterHubUrlAdded(state.baseUrl, state.hubVersion, id);
                    await this.storage.addServerOrUpdate(
                        {
                            id,
                            baseUrl: state.baseUrl,
                            displayName: state.displayName,
                            serverName: state.serverName
                        },
                        state.auth
                    );
                    return {
                        id,
                        label: state.displayName
                    };
                }
                if (nextStep) {
                    // If nextStep is something that we have already executed in the past
                    // then this means we're actually going back to that step.
                    // So, remove everything from the stack that we have executed in the past.
                    if (stepsExecuted.includes(nextStep)) {
                        stepsExecuted.splice(stepsExecuted.indexOf(nextStep));
                        continue;
                    }
                    if (step.canNavigateBackToThis) {
                        stepsExecuted.push(step.step);
                    }
                    continue;
                }
                if (stepsExecuted.length) {
                    nextStep = stepsExecuted.pop();
                    continue;
                }
                sendJupyterHubUrlNotAdded('cancel', step.step);
                return;
            }
        } catch (ex) {
            if (ex instanceof CancellationError) {
                sendJupyterHubUrlNotAdded('cancel', '');
            } else {
                traceError('Failed to capture remote jupyter server', ex);
                sendJupyterHubUrlNotAdded('error', '');
            }
            throw ex;
        } finally {
            dispose(disposables);
        }
    }
}
type Step =
    | 'Before'
    | 'Get Url'
    | 'Get Credentials'
    | 'Get Username'
    | 'Verify Connection'
    | 'Server Selector'
    | 'Get Display Name'
    | 'After';

interface MultiStep<T, State> {
    step: Step;
    /**
     * Whether this step is disabled.
     * Can get disabled as a result of calling `run`.
     * Meaning, this step should be skipped in the future.
     */
    disabled?: boolean;
    canNavigateBackToThis: boolean;
    dispose(): void;
    run(state: State, token: CancellationToken): Promise<T | undefined>;
}
type State = {
    displayNamesOfHandles: Map<string, string>;
    urlWasPrePopulated: boolean;
    serverId: string;
    /**
     * Name of the server to start (named jupyter hub servers).
     */
    serverName: string | undefined;
    errorMessage: string;
    url: string;
    displayName: string;
    baseUrl: string;
    hubVersion: string;
    auth: JupyterHubAuthInfo;
};

class GetUrlStep extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Get Url';
    canNavigateBackToThis = true;
    constructor(private readonly fetch: SimpleFetch) {
        super();
    }
    async run(state: State, token: CancellationToken) {
        if (!state.url) {
            try {
                // In web trying to read clipboard can be iffy, as users may get a prompt to allow that.
                // And that UX isn't great. So skip this for web.
                const text = isWebExtension() ? '' : await env.clipboard.readText();
                const parsedUri = new URL(text.trim());
                // Only display http/https uris.
                state.url = text && parsedUri && parsedUri.protocol.toLowerCase().startsWith('http') ? text : '';
            } catch {
                // We can ignore errors.
            }
        }
        const validationMessage = state.errorMessage;
        state.errorMessage = '';
        const url = await this.add(new WorkflowInputCapture()).getValue(
            {
                title: Localized.titleOfInputBoxToEnterUrl,
                placeholder: Localized.placeholderOfInputBoxToEnterUrl,
                value: state.url,
                validationMessage,
                validateInput: async (value) => {
                    value = value.trim();
                    if (!isValidUrl(value)) {
                        return Localized.jupyterSelectURIInvalidURI;
                    }
                    try {
                        await getJupyterHubBaseUrl(value, this.fetch, token);
                    } catch (ex) {
                        traceError(`Failed to determine base url for ${value}`, ex);
                        return Localized.invalidJupyterHubUrl;
                    }
                }
            },
            token
        );

        if (!url) {
            return;
        }
        state.url = url;
        state.baseUrl = await getJupyterHubBaseUrl(url, this.fetch, token);
        state.hubVersion = await getVersion(state.baseUrl, this.fetch, token);
        state.auth.username = state.auth.username || extractUserNameFromUrl(url) || '';
        state.auth.token = state.auth.token || extractTokenFromUrl(url) || '';
        if (state.auth.token) {
            state.auth.authKind = 'token';
            return 'Verify Connection';
        }
        return 'Get Credentials';
    }
}
class GetUserName extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Get Username';
    canNavigateBackToThis = true;
    async run(state: State, token: CancellationToken) {
        const errorMessage = state.errorMessage;
        state.errorMessage = ''; // Never display this validation message again.
        const username = await this.add(new WorkflowInputCapture()).getValue(
            {
                title: Localized.captureUserNameTitle,
                value: state.auth.username || extractUserNameFromUrl(state.url),
                placeholder: Localized.captureUserNamePrompt,
                validationMessage: errorMessage,
                validateInput: async (value) => (value ? undefined : Localized.emptyUserNameErrorMessage)
            },
            token
        );
        if (!username) {
            return;
        }
        state.auth.username = username;
        return 'Verify Connection';
    }
}
class GetCredentials extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Get Credentials';
    canNavigateBackToThis = true;
    constructor(private readonly tmpAuthBootstrapper?: ITmpAuthenticatorBootstrapper) {
        super();
    }

    async run(state: State, token: CancellationToken): Promise<Step | undefined> {
        if (state.auth.token && !state.auth.password && !state.errorMessage) {
            return 'Verify Connection';
        }
        if (
            !isWebExtension() &&
            this.tmpAuthBootstrapper &&
            !state.auth.username &&
            !state.auth.password &&
            !state.auth.token
        ) {
            const bootstrappedAuth = await this.tmpAuthBootstrapper
                .tryBootstrapJupyterHubAuth(state.baseUrl, token)
                .catch((ex) => {
                    if (ex instanceof CancellationError) {
                        throw ex;
                    }
                    traceDebug(`Temporary login bootstrap did not complete for ${state.baseUrl}`, ex);
                    return undefined;
                });
            if (bootstrappedAuth) {
                state.auth = { ...state.auth, ...bootstrappedAuth, password: '' };
                return 'Verify Connection';
            }
        }

        const input = this.add(new WorkflowInputCapture());
        const openTokenPage: QuickInputButton = {
            iconPath: new ThemeIcon('link-external'),
            tooltip: Localized.openJupyterHubTokenPageTooltip
        };
        const validationMessage = state.errorMessage;
        state.errorMessage = '';
        const credentials = await input.getValue(
            {
                title: Localized.captureCredentialsTitle,
                placeholder: Localized.captureCredentialsPrompt,
                value: state.auth.password || state.auth.token || extractTokenFromUrl(state.url) || '',
                password: true,
                validationMessage,
                buttons: [openTokenPage],
                onDidTriggerButton: (e) => {
                    if (e === openTokenPage) {
                        env.openExternal(Uri.parse(appendUrlPath(state.baseUrl, 'hub/token'))).then(noop, noop);
                    }
                },
                validateInput: async (value) => {
                    if (!value) {
                        return Localized.emptyCredentialsErrorMessage;
                    }
                }
            },
            token
        );
        if (!credentials) {
            return;
        }
        state.auth.password = credentials;
        state.auth.authKind = 'password';
        state.auth.token = '';
        state.auth.tokenId = '';
        return 'Verify Connection';
    }
}

class VerifyConnection extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Verify Connection';
    canNavigateBackToThis = false;
    constructor(
        private readonly jupyterConnection: JupyterHubConnectionValidator,
        private readonly authenticator: IAuthenticator
    ) {
        super();
    }
    async run(state: State, token: CancellationToken): Promise<Step | undefined> {
        try {
            const result = await this.authenticator.getJupyterAuthInfo(
                {
                    baseUrl: state.baseUrl,
                    authInfo: state.auth
                },
                token
            );
            state.auth = {
                ...state.auth,
                authKind: result.authKind,
                username: result.username,
                token: result.token || '',
                tokenId: result.tokenId || '',
                password: result.authKind === 'password' ? state.auth.password : ''
            };
            traceDebug(
                `Got an Auth token = ${state.auth.token.length} && ${state.auth.token.trim().length}, tokenId = ${
                    state.auth.tokenId.length
                } && ${state.auth.tokenId.trim().length} for ${state.baseUrl}`
            );
            await this.jupyterConnection.validateJupyterUri(state.baseUrl, state.auth, this.authenticator, token);
        } catch (err) {
            traceError('Uri verification error', err);
            if (err instanceof CancellationError) {
                throw err;
            } else if (err instanceof JupyterHubMissingUsernameError) {
                state.errorMessage = Localized.passwordAuthRequiresUserName;
                return 'Get Username';
            } else if (isSelfCertsError(err)) {
                state.errorMessage = Localized.jupyterSelfCertFailErrorMessageOnly;
                return 'Get Url';
            } else if (isSelfCertsExpiredError(err)) {
                state.errorMessage = Localized.jupyterSelfCertExpiredErrorMessageOnly;
                return 'Get Url';
            } else {
                state.errorMessage = Localized.jupyterHubCredentialsAuthFailure;
                return 'Get Credentials';
            }
        }
        return 'Server Selector';
    }
}

function getServerStatus(server: ApiTypes.ServerInfo) {
    switch (server.pending) {
        case 'spawn':
            return l10n.t('Starting');
        case 'stop':
            return l10n.t('Shutting down');
        default:
            return server.ready ? l10n.t('Running') : l10n.t('Stopped');
    }
}
class ServerSelector extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Server Selector';
    disabled?: boolean | undefined;
    canNavigateBackToThis = false;
    constructor(private readonly fetch: SimpleFetch) {
        super();
    }
    async run(state: State, token: CancellationToken): Promise<Step | undefined> {
        try {
            const servers = await listServers(state.baseUrl, state.auth.username, state.auth.token, this.fetch, token);
            if (servers.length === 0 || (servers.length === 1 && !servers[0].name)) {
                traceDebug('No servers found for the user');
                this.disabled = true;
                return 'Get Display Name';
            }

            interface ServerQuickPick extends QuickPickItem {
                server: ApiTypes.ServerInfo;
            }

            const quickPickItems: ServerQuickPick[] = servers.map((server) => ({
                label: server.name || 'Default Server',
                description: `(${getServerStatus(server)})`,
                server
            }));
            const selection = await new WorkflowInputCapture().pickValue(
                {
                    title: l10n.t('Select a Server'),
                    quickPickItems
                },
                token
            );
            if (!selection) {
                return;
            }
            state.serverName = selection.server.name;
        } catch (err) {
            if (err instanceof CancellationError) {
                throw err;
            }
            this.disabled = true;
            traceWarn("Failed to list all of the servers for the user, assuming there aren't any", err);
        }
        return 'Get Display Name';
    }
}
class GetDisplayName extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Get Display Name';
    canNavigateBackToThis = false;
    constructor(private readonly storage: JupyterHubServerStorage) {
        super();
    }
    async run(state: State, token: CancellationToken): Promise<Step | undefined> {
        const suggestedDisplayName = getSuggestedDisplayName(
            state.url,
            state.serverName,
            this.storage.all.map((s) => s.displayName)
        );
        const displayName = await this.add(new WorkflowInputCapture()).getValue(
            {
                title: Localized.jupyterRenameServer,
                value: state.displayName || suggestedDisplayName
            },
            token
        );
        if (!displayName) {
            return;
        }
        state.displayName = displayName;
        return 'After';
    }
}

export function getSuggestedDisplayName(baseUrl: string, serverName: string | undefined, usedNames: string[]) {
    const usedNamesSet = new Set(usedNames.map((s) => s.toLowerCase()));
    usedNamesSet.add('localhost');
    usedNamesSet.add('');
    const isIPAddress = typeof parseInt(new URL(baseUrl).hostname.charAt(0), 10) === 'number';
    let hostName = isIPAddress ? 'JupyterHub' : new URL(baseUrl).hostname;
    hostName = serverName ? `${hostName} (${serverName})` : hostName;
    if (!isIPAddress && !usedNamesSet.has(hostName.toLowerCase())) {
        return hostName;
    }
    for (let i = 0; i < 10; i++) {
        const name = i === 0 ? hostName : `${hostName} ${i}`;
        if (!usedNamesSet.has(name.toLowerCase())) {
            return name;
        }
    }
    return 'JupyterHub';
}

function isValidUrl(value: string) {
    try {
        new URL(value);
        return true;
    } catch (err) {
        traceDebug(`Failed to parse URI`, err);
        return false;
    }
}
