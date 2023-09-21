// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require('fs');
const path = require('path');

// Web tests do not work with an extension dependency, convert to extension pack & then things work magically.
const file = path.join(__dirname, '../package.json');
const contentes = fs.readFileSync(file).toString();
fs.writeFileSync(file, contentes.replace('"extensionDependencies"', '"extensionPack"'));
