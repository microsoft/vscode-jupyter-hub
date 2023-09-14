// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BaseCookieStore } from './common/cookieStore.base';
import { ClassType } from './common/types';
import { IJupyterRequestCreator } from './types';

// This is only used in tests.
// We have a few different implementations of some interfaces that vary depending on web or desktop/
// We'd like to test both, with the same testse.
// Instead of building a DI container we'll just map the classes so we can get them in tests (lite di container esp like class)

export type ClassImplementationsForTests = {
    RequestCreator: ClassType<IJupyterRequestCreator>;
    CookieStore: ClassType<BaseCookieStore>;
};
