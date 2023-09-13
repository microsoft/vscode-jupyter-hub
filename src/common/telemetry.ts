// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import TelemetryReporter from '@vscode/extension-telemetry';
import { AppInsightsKey } from './constants';
import { disposableStore } from './lifecycle';

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
