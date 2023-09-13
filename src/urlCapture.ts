// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, CancellationToken, QuickInputButton, ThemeIcon, Uri, env } from 'vscode';
import type { JupyterServer } from '@vscode/jupyter-extension';
import { Localized } from './common/localize';
import { noop, uuid } from './common/utils';
import { traceDebug, traceError } from './common/logging';
import { DisposableStore, dispose } from './common/lifecycle';
import { JupyterHubConnectionValidator, isSelfCertsError, isSelfCertsExpiredError } from './validator';
import { WorkflowInputCapture, WorkflowQuickInputCapture } from './common/inputCapture';
import { JupyterHubServerStorage } from './storage';
import { SimpleFetch } from './common/request';
import { BaseCookieStore } from './common/cookieStore.base';
import { ClassType } from './common/types';
import { AuthenticationNotSupportedError, IAuthenticator } from './authenticators/types';
import { OldUserNamePasswordAuthenticator } from './authenticators/passwordConnect';
import { UserNamePasswordAuthenticator } from './authenticators/usernamePassword';
import { extractUserNameFromUrl, getJupyterHubBaseUrl } from './jupyterHubApi';

class AuthenticationError extends Error {
    constructor(public readonly ex: Error) {
        super(ex.message || ex.toString());
    }
}
export class JupyterHubUrlCapture {
    private readonly jupyterConnection: JupyterHubConnectionValidator;
    private readonly displayNamesOfHandles = new Map<string, string>();
    private readonly oldAuthenticator: OldUserNamePasswordAuthenticator;
    private readonly newAuthenticator: UserNamePasswordAuthenticator;
    private readonly disposable = new DisposableStore();
    constructor(
        private readonly fetch: SimpleFetch,
        private readonly isWebExtension: boolean,
        private readonly storage: JupyterHubServerStorage,
        CookieStore: ClassType<BaseCookieStore>
    ) {
        this.oldAuthenticator = this.disposable.add(new OldUserNamePasswordAuthenticator(fetch));
        this.newAuthenticator = this.disposable.add(new UserNamePasswordAuthenticator(fetch, CookieStore));
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
        // First try the new auth class, then if that fails try the old authentication mechanism.
        const authenticators = [this.oldAuthenticator];
        let authenticator: IAuthenticator = this.newAuthenticator;
        let fallbackToOldAuthenticator = true;
        const resetAndGetNextAuthenticator = () => {
            if (!fallbackToOldAuthenticator) {
                return this.newAuthenticator;
            }
            // Previous authenticator did not work, try the next one.
            const nextAuth = authenticators.shift();
            if (!nextAuth) {
                authenticators.push(this.oldAuthenticator);
                return this.newAuthenticator;
            } else {
                return nextAuth;
            }
        };
        let errorMessageWhenAuthFirstFailed = '';
        try {
            while (true) {
                try {
                    return await this.captureRemoteJupyterUrlImpl(
                        authenticator,
                        initialUrl,
                        displayName,
                        validationErrorMessage,
                        serverId,
                        reasonForCapture,
                        token
                    );
                } catch (ex) {
                    if (ex instanceof CancellationError) {
                        throw ex;
                    } else if (ex instanceof AuthenticationNotSupportedError) {
                        // This is throw by the old authenticator class,
                        // If we get this error that means both new and old auth failed.
                        // Lets try again without falling back to any other authenticator.
                        fallbackToOldAuthenticator = false;
                        authenticator = this.newAuthenticator;
                        continue;
                    } else if (ex instanceof AuthenticationError || ex instanceof AuthenticationError) {
                        // Auth failed, keep track of this and try the next authenticator with the same user name & pwd info.
                        errorMessageWhenAuthFirstFailed = errorMessageWhenAuthFirstFailed || ex.message;
                        const nextAuth = authenticators.shift();
                        if (!nextAuth) {
                            // We have exhausted all auth providers,
                            // Now lets display the first error message we got with the first auth provider

                            const urlRegex = /(https?:\/\/[^\s]+)/g;
                            const errorMessage = errorMessageWhenAuthFirstFailed.replace(
                                urlRegex,
                                (url: string) => `[${url}](${url})`
                            );
                            validationErrorMessage = (
                                this.isWebExtension
                                    ? Localized.remoteJupyterConnectionFailedWithoutServerWithErrorWeb
                                    : Localized.remoteJupyterConnectionFailedWithoutServerWithError
                            )(errorMessage);

                            errorMessageWhenAuthFirstFailed = '';
                            authenticator = resetAndGetNextAuthenticator();
                        } else {
                            // Try the next authenticator.
                            validationErrorMessage = '';
                            authenticator = nextAuth;
                        }
                        continue;
                    }
                }
            }
        } catch (ex) {
            if (!(ex instanceof CancellationError)) {
                traceError('Failed to capture remote jupyter server', ex);
            }
            throw ex;
        }
    }
    public async captureRemoteJupyterUrlImpl(
        authenticator: IAuthenticator,
        url: string = '',
        displayName: string = '',
        validationErrorMessage: string = '',
        id = uuid(),
        reasonForCapture: 'cameHereFromBackButton' | 'captureNewUrl' = 'captureNewUrl',
        token: CancellationToken
    ): Promise<JupyterServer | undefined> {
        const steps: MultiStep<Step, State>[] = [
            new GetUrlStep(this.fetch, this.isWebExtension),
            new CheckAuthMethod(),
            new GetUserName(),
            new GetPassword(),
            new GetApiToken(),
            new GetHeadersAndCookies(authenticator),
            new VerifyConnection(this.jupyterConnection, authenticator),
            new GetDisplayName(this.storage)
        ];
        const disposables = new DisposableStore();
        let nextStep: Step | undefined = 'Get Url';
        const state: State = {
            auth: { username: '', password: '', token: '' },
            baseUrl: '',
            urlWasPrePopulated: false,
            url,
            displayName,
            displayNamesOfHandles: this.displayNamesOfHandles,
            errorMessage: validationErrorMessage,
            serverId: id
        };
        if (url) {
            // Validate the URI first, which would otherwise be validated when user enters the Uri into the input box.
            if (isValidUrl(url)) {
                try {
                    state.baseUrl = await getJupyterHubBaseUrl(url, this.fetch, token);
                    state.urlWasPrePopulated = true;
                    nextStep = reasonForCapture === 'captureNewUrl' ? 'Check Auth Method' : 'Get Url';
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
                const step = steps.find((s) => s.step === nextStep);
                if (!step) {
                    traceError(`Step '${nextStep}' Not found`);
                    throw new CancellationError();
                }
                nextStep = await step.run(state, token);
                if (nextStep === 'Before') {
                    return;
                }
                if (nextStep === 'After') {
                    await this.storage.addServerOrUpdate(
                        {
                            authProvider: authenticator === this.oldAuthenticator ? 'old' : 'new',
                            id,
                            baseUrl: state.baseUrl,
                            displayName: state.displayName
                        },
                        {
                            username: state.auth.username,
                            password: state.auth.password,
                            token: state.auth.token || ''
                        }
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
                return;
            }
        } catch (ex) {
            if (!(ex instanceof CancellationError)) {
                traceError('Failed to capture remote jupyter server', ex);
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
    | 'Check Auth Method'
    | 'Get Username'
    | 'Get Password'
    | 'Get API Token'
    | 'Get Authentication Headers and Cookies'
    | 'Verify Connection'
    | 'Get Display Name'
    | 'After';

interface MultiStep<T, State> {
    step: Step;
    canNavigateBackToThis: boolean;
    dispose(): void;
    run(state: State, token: CancellationToken): Promise<T | undefined>;
}
type State = {
    displayNamesOfHandles: Map<string, string>;
    urlWasPrePopulated: boolean;
    serverId: string;
    errorMessage: string;
    url: string;
    displayName: string;
    baseUrl: string;
    auth: { username: string; password: string; token: string; headers?: Record<string, string> };
};
class GetUrlStep extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Get Url';
    canNavigateBackToThis = true;
    constructor(
        private readonly fetch: SimpleFetch,
        private readonly isWebExtension: boolean
    ) {
        super();
    }
    async run(state: State, token: CancellationToken) {
        if (!state.url) {
            try {
                // In web trying to read clipboard can be iffy, as users may get a prompt to allow that.
                // And that UX isn't great. So skip this for web.
                const text = this.isWebExtension ? '' : await env.clipboard.readText();
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
        state.auth.username = state.auth.username || extractUserNameFromUrl(url) || '';
        return 'Check Auth Method';
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
        state.auth.token = '';
        return 'Get Password';
    }
}
class GetPassword extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Get Password';
    canNavigateBackToThis = true;
    async run(state: State, token: CancellationToken): Promise<Step | undefined> {
        const password = await this.add(new WorkflowInputCapture()).getValue(
            {
                title: Localized.capturePasswordTitle,
                placeholder: Localized.capturePasswordPrompt,
                password: true,
                validateInput: async (value) => (value ? undefined : Localized.emptyPasswordErrorMessage)
            },
            token
        );
        if (!password) {
            return;
        }
        state.auth.password = password;
        state.auth.token = '';
        return 'Get Authentication Headers and Cookies';
    }
}
class GetApiToken extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Get API Token';
    canNavigateBackToThis = true;
    async run(state: State, token: CancellationToken) {
        const errorMessage = state.errorMessage;
        state.errorMessage = ''; // Never display this validation message again.
        const authToken = await this.add(new WorkflowInputCapture()).getValue(
            {
                title: Localized.enterApiQuickPickTitle,
                placeholder: Localized.enterApiQuickPickPlaceholder,
                password: true,
                validationMessage: errorMessage,
                validateInput: async (value) => (value ? undefined : Localized.enterApiQuickPickEmptyErrorMessage)
            },
            token
        );
        if (!authToken) {
            return;
        }
        state.auth.username = '';
        state.auth.password = '';
        state.auth.token = authToken;
        return 'Get Authentication Headers and Cookies';
    }
}
class CheckAuthMethod extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Check Auth Method';
    canNavigateBackToThis = true;
    async run(_state: State, token: CancellationToken): Promise<Step | undefined> {
        const authMethod = this.add(new WorkflowQuickInputCapture());
        const moreInfoButton: QuickInputButton = {
            iconPath: new ThemeIcon('info'),
            tooltip: Localized.authMethodApiTokenMoreInfoTooltip
        };
        this.add(
            authMethod.onDidTriggerItemButton((e) => {
                if (e.button === moreInfoButton) {
                    env.openExternal(Uri.parse('http://www.google.com')).then(noop, noop);
                }
            }, undefined)
        );
        const result = await authMethod.getValue(
            {
                title: Localized.howWouldYouLikeToConnectToJupyterHubTitle,
                placeholder: Localized.howWouldYouLikeToConnectToJupyterHubPlaceholder,
                items: [
                    { label: Localized.authMethodUserNamePwd },
                    {
                        label: Localized.authMethodApiToken,
                        buttons: [moreInfoButton]
                    }
                ]
            },
            token
        );
        if (!result) {
            return;
        }
        return result.label === Localized.authMethodUserNamePwd ? 'Get Username' : 'Get API Token';
    }
}

class GetHeadersAndCookies extends DisposableStore implements MultiStep<Step, State> {
    step: Step = 'Get Authentication Headers and Cookies';
    canNavigateBackToThis = false;
    constructor(private readonly authenticator: IAuthenticator) {
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
            if (!result) {
                // This only happens with the old auth class,
                // If we're here, then this means both the old and new auth methods failed.
                throw new AuthenticationNotSupportedError();
            }

            state.auth.headers = result.headers;
            state.auth.token = result.token || state.auth.token;
        } catch (err) {
            traceError('Failed to get Auth Info', err);
            if (err instanceof AuthenticationNotSupportedError) {
                throw err;
            } else if (err instanceof CancellationError) {
                throw err;
            } else if (isSelfCertsError(err)) {
                // We can skip this for now, as this will get verified again
                // First we need to check with user whether to allow insecure connections and untrusted certs.
            } else if (isSelfCertsExpiredError(err)) {
                // We can skip this for now, as this will get verified again
                // First we need to check with user whether to allow insecure connections and untrusted certs.
            } else {
                traceError(`Failed to validate user name and password for ${state.baseUrl}`, err);
                throw new AuthenticationError(err);
            }
        }
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
            await this.jupyterConnection.validateJupyterUri(state.baseUrl, state.auth, this.authenticator, token);
        } catch (err) {
            traceError('Uri verification error', err);
            if (err instanceof CancellationError) {
                throw err;
            } else if (isSelfCertsError(err)) {
                state.errorMessage = Localized.jupyterSelfCertFailErrorMessageOnly;
                return 'Get Url';
            } else if (isSelfCertsExpiredError(err)) {
                state.errorMessage = Localized.jupyterSelfCertExpiredErrorMessageOnly;
                return 'Get Url';
            } else {
                state.errorMessage = state.auth.username
                    ? Localized.usernamePasswordAuthFailure
                    : Localized.apiTokenAuthFailure;
                return state.auth.username ? 'Get Username' : 'Get API Token';
            }
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

export function getSuggestedDisplayName(baseUrl: string, usedNames: string[]) {
    const usedNamesSet = new Set(usedNames.map((s) => s.toLowerCase()));
    usedNamesSet.add('localhost');
    usedNamesSet.add('');
    const isIPAddress = typeof parseInt(new URL(baseUrl).hostname.charAt(0), 10) === 'number';
    const hostName = isIPAddress ? 'JupyterHub' : new URL(baseUrl).hostname;
    if (!isIPAddress && !usedNamesSet.has(hostName.toLowerCase())) {
        return hostName;
    }
    for (let i = 1; i < 10; i++) {
        const name = `${hostName} ${i}`;
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
