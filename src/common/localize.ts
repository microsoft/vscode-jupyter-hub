// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { l10n } from 'vscode';

// Most messages are re-used, hence keep them in a single place and re-use.
export namespace Localized {
    export const OutputChannelName = l10n.t('JupyterHub');
    export const ConnectingToJupyterServer = l10n.t('Connecting to JupyterHub Server');
    export const startingJupyterServer = l10n.t('Starting Server');
    export const KernelActionSourceTitle = l10n.t('Existing JupyterHub Server...');
    export const labelOfCommandToEnterUrl = l10n.t('Enter the URL of the running JupyterHub Server...');
    export const placeholderOfInputBoxToEnterUrl = l10n.t('Enter the URL of the running JupyterHub Server');
    export const titleOfInputBoxToEnterUrl = l10n.t('Enter the URL of the running JupyterHub Server');
    export const captureUserNameTitle = l10n.t('Enter your username');
    export const captureUserNamePrompt = l10n.t('username');
    export const captureCredentialsTitle = l10n.t('Enter your password or API token');
    export const captureCredentialsPrompt = l10n.t('password or token');
    export const jupyterHubCredentialsAuthFailure = l10n.t(
        'Unable to authenticate. Verify your password or API token.'
    );
    export const passwordAuthRequiresUserName = l10n.t(
        'Enter a username to sign in with a password, or go back and provide an API token.'
    );
    export const jupyterSelfCertFail = (errorMessage: string) =>
        l10n.t(
            'The security certificate used by server {0} was not issued by a trusted certificate authority.\r\nThis may indicate an attempt to steal your information.\r\nDo you want to enable the Allow Unauthorized Remote Connection setting for this workspace to allow you to connect?',
            errorMessage
        );
    export const jupyterExpiredCertFail = (errorMessage: string) =>
        l10n.t(
            'The security certificate used by server {0} has expired.\r\nThis may indicate an attempt to steal your information.\r\nDo you want to enable the Allow Unauthorized Remote Connection setting for this workspace to allow you to connect?',
            errorMessage
        );
    export const jupyterSelfCertFailErrorMessageOnly = l10n.t(
        'The security certificate used by server was not issued by a trusted certificate authority.\r\nThis may indicate an attempt to steal your information.'
    );
    export const jupyterSelfCertExpiredErrorMessageOnly = l10n.t(
        'The security certificate used by server has expired.\r\nThis may indicate an attempt to steal your information.'
    );
    export const jupyterSelfCertEnable = l10n.t('Yes, connect anyway');
    export const jupyterSelfCertClose = l10n.t('No, close the connection');
    export const connectToToTheJupyterServer = (url: string) => l10n.t('Connect to the JupyterHub server {0}', url);
    export const jupyterSelectURIInvalidURI = l10n.t('Invalid URL specified');
    export const invalidJupyterHubUrl = l10n.t('Invalid JupyterHub URL specified');
    export const jupyterRenameServer = l10n.t('Change server name');
    export const remoteJupyterConnectionFailedWithoutServerWithError = (errorMessage: string) =>
        l10n.t('Connection failure. Verify the server is running and reachable. ({0}).', errorMessage);
    export const emptyUserNameErrorMessage = l10n.t('Username cannot be empty');
    export const emptyCredentialsErrorMessage = l10n.t('Password/API token cannot be empty');
    export const openJupyterHubTokenPageTooltip = l10n.t('Open token page');

    // Backward-compatible aliases for older references.
    export const capturePasswordTitle = captureCredentialsTitle;
    export const capturePasswordPrompt = captureCredentialsPrompt;
    export const usernamePasswordAuthFailure = jupyterHubCredentialsAuthFailure;
    export const emptyPasswordErrorMessage = emptyCredentialsErrorMessage;
    export const authMethodApiTokenMoreInfoTooltip = openJupyterHubTokenPageTooltip;
}
