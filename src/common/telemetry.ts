// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import TelemetryReporter from '@vscode/extension-telemetry';
import { AppInsightsKey } from './constants';
import { disposableStore } from './lifecycle';
import { computeHash } from './crypto';
import { noop } from './utils';

// #region Telemetry

// #endregion

export interface IPropertyData {
    classification:
        | 'SystemMetaData'
        | 'CallstackOrException'
        | 'CustomerContent'
        | 'PublicNonPersonalData'
        | 'EndUserPseudonymizedInformation';
    purpose: 'PerformanceAndHealth' | 'FeatureInsight' | 'BusinessInsight';
    comment: string;
    expiration?: string;
    endpoint?: string;
    isMeasurement?: boolean;
}

export interface IGDPRProperty {
    owner: string;
    comment: string;
    expiration?: string;
    readonly [name: string]: IPropertyData | undefined | IGDPRProperty | string;
}

type IGDPRPropertyWithoutMetadata = Omit<IGDPRProperty, 'owner' | 'comment' | 'expiration'>;
export type OmitMetadata<T> = Omit<T, 'owner' | 'comment' | 'expiration'>;

export type ClassifiedEvent<T extends IGDPRPropertyWithoutMetadata> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [k in keyof T]: any;
};

export type StrictPropertyChecker<TEvent, TClassification, TError> =
    keyof TEvent extends keyof OmitMetadata<TClassification>
        ? keyof OmitMetadata<TClassification> extends keyof TEvent
            ? TEvent
            : TError
        : TError;

export type StrictPropertyCheckError = { error: 'Type of classified event does not match event properties' };

export type StrictPropertyCheck<T extends IGDPRProperty, E> = StrictPropertyChecker<
    E,
    ClassifiedEvent<OmitMetadata<T>>,
    StrictPropertyCheckError
>;

let telemetryReporter: TelemetryReporter;

/**
 * Send this & subsequent telemetry only after this promise has been resolved.
 * We have a default timeout of 30s.
 * @param {P[E]} [properties]
 * Can optionally contain a property `waitBeforeSending` referencing a promise.
 * Which must be awaited before sending the telemetry.
 */
export function publicLog2<E extends ClassifiedEvent<OmitMetadata<T>> = never, T extends IGDPRProperty = never>(
    eventName: string,
    data?: StrictPropertyCheck<T, E>
) {
    telemetryReporter = telemetryReporter
        ? telemetryReporter
        : disposableStore.add(new TelemetryReporter(AppInsightsKey));
    telemetryReporter.sendTelemetryEvent(eventName, data);
}

const urlsAndVersion = new Map<string, string>();
function getHostName(url: string) {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

interface JupyterHubUrlAddedData {
    serverId: string;
    hostNameHash: string;
    baseUrlHash: string;
    version: number;
}
type JupyterHubUrlDataClassification = {
    owner: 'donjayamanne';
    comment: 'Jupyter Hub Versions';
    serverId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'unique identifier of server' };
    hostNameHash: {
        classification: 'SystemMetaData';
        purpose: 'FeatureInsight';
        comment: 'Hash of the host name of the server';
    };
    baseUrlHash: {
        classification: 'SystemMetaData';
        purpose: 'FeatureInsight';
        comment: 'Hash of the base url';
    };
    version: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Version of JupyterHub' };
};
function stripPIIFromVersion(version: string) {
    const parts = version.split('.');
    if (parts.length < 2) {
        return 0;
    }
    return parseFloat(`${parseInt(parts[0], 10)}.${parseInt(parts[1], 10)}`);
}

/**
 * Safe way to send data in telemetry (obfuscate PII).
 */
export async function getTelemetrySafeHashedString(data: string) {
    return computeHash(data, 'SHA-256');
}

export function sendJupyterHubUrlAdded(baseUrl: string, version: string, serverId: string) {
    urlsAndVersion.set(baseUrl, version);
    Promise.all([getTelemetrySafeHashedString(getHostName(baseUrl)), getTelemetrySafeHashedString(baseUrl)])
        .then(([hostNameHash, baseUrlHash]) => {
            publicLog2<JupyterHubUrlAddedData, JupyterHubUrlDataClassification>('addJupyterHubUrl', {
                serverId,
                hostNameHash,
                baseUrlHash,
                version: stripPIIFromVersion(version)
            });
        })
        .catch(noop);
}

interface JupyterHubUrlNotAdded {
    failed: true;
    reason: 'cancel' | 'back' | 'error';
    lastStep:
        | ''
        | 'Before'
        | 'Get Url'
        | 'Get Username'
        | 'Get Password'
        | 'Verify Connection'
        | 'Get Display Name'
        | 'After';
}
type JupyterHubUrlNotAddedClassification = {
    owner: 'donjayamanne';
    comment: 'Url was not added';
    failed: {
        classification: 'SystemMetaData';
        purpose: 'FeatureInsight';
        comment: 'Indicator that adding the Url failed';
    };
    reason: {
        classification: 'SystemMetaData';
        purpose: 'FeatureInsight';
        comment: 'Reason for cancellation, back, cancel or error';
    };
    lastStep: {
        classification: 'SystemMetaData';
        purpose: 'FeatureInsight';
        comment: 'Last step the user took before exiting the workflow to add a url';
    };
};

export function sendJupyterHubUrlNotAdded(
    reason: 'cancel' | 'back' | 'error',
    lastStep:
        | ''
        | 'Before'
        | 'Get Url'
        | 'Get Username'
        | 'Get Password'
        | 'Verify Connection'
        | 'Get Display Name'
        | 'After'
) {
    publicLog2<JupyterHubUrlNotAdded, JupyterHubUrlNotAddedClassification>('addJupyterHubUrl', {
        failed: true,
        reason,
        lastStep
    });
}

interface JupyterHubTokenGeneratedUsingOldAPIData {
    hostNameHash: string;
    baseUrlHash: string;
}
type JupyterHubTokenGeneratedUsingOldAPIDataClassification = {
    owner: 'donjayamanne';
    comment: 'Sent when we generate API tokens using the old API';
    hostNameHash: {
        classification: 'SystemMetaData';
        purpose: 'FeatureInsight';
        comment: 'Hash of the host name of the server';
    };
    baseUrlHash: {
        classification: 'SystemMetaData';
        purpose: 'FeatureInsight';
        comment: 'Hash of the base url';
    };
};

export function trackUsageOfOldApiGeneration(baseUrl: string) {
    Promise.all([getTelemetrySafeHashedString(getHostName(baseUrl)), getTelemetrySafeHashedString(baseUrl)])
        .then(([hostNameHash, baseUrlHash]) => {
            publicLog2<JupyterHubTokenGeneratedUsingOldAPIData, JupyterHubTokenGeneratedUsingOldAPIDataClassification>(
                'generateTokenWithOldApi',
                {
                    hostNameHash,
                    baseUrlHash
                }
            );
        })
        .catch(noop);
}
interface JupyterHubUsage {}
type JupyterHubUsageClassification = {
    owner: 'donjayamanne';
    comment: 'Sent extension activates';
};

export function trackInstallOfExtension() {
    publicLog2<JupyterHubUsage, JupyterHubUsageClassification>('activated', {});
}

interface JupyterHubUrlCertProblemsSolutionData {
    solution: 'allow' | 'cancel';
    problem: 'self-signed' | 'expired';
}
type JupyterHubUrlCertProblemsSolutionDataClassification = {
    owner: 'donjayamanne';
    comment: 'Sent when user attempts to overcome a cert problem';
    problem: {
        classification: 'SystemMetaData';
        purpose: 'FeatureInsight';
        comment: 'Problem with certificate';
    };
    solution: {
        classification: 'SystemMetaData';
        purpose: 'FeatureInsight';
        comment: 'How did user solve the cert problem did they allow usage of untrusted certs or cancel adding them';
    };
};

export function solveCertificateProblem(problem: 'self-signed' | 'expired', solution: 'allow' | 'cancel') {
    publicLog2<JupyterHubUrlCertProblemsSolutionData, JupyterHubUrlCertProblemsSolutionDataClassification>(
        'addJupyterHubUrlWithCertProblem',
        {
            solution,
            problem
        }
    );
}
