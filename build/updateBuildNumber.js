// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require('fs');


/**
 * For multi-platform builds We end up generating multiple VSIX in the same pipeline.
 * As a result this runs multiple times in the same pipeline,
 * and we can have different build numbers for different VSIX.
 *
 * On CI, we use the Azure Build Number to generate a unique build number.
 * The Azure Build Number will contain the date time information of the current build time
 */
function getBuildDate() {
    const vscBuildId = process.env.VSC_BUILD_ID || '';
    const buildParts = vscBuildId.split('_');
    if (buildParts.length >= 3) {
        return new Date(
            parseInt(buildParts[0].substring(0, 4), 10),
            parseInt(buildParts[0].substring(4, 6), 10) - 1,
            parseInt(buildParts[0].substring(6), 10),
            parseInt(buildParts[1], 10),
            parseInt(buildParts[2], 10)
        );
    } else {
        return new Date();
    }
}
function updateBuildNumber() {
    // Edit the version number from the package.json
    const packageJsonContents = fs.readFileSync('package.json', 'utf-8');
    const packageJson = JSON.parse(packageJsonContents);

    // Change version number
    // 3rd part of version is limited to Max Int32 numbers (in VSC Marketplace).
    // Hence build numbers can only be YYYY.MMM.2147483647
    // NOTE: For each of the following strip the first 3 characters from the build number.
    //  E.g. if we have build number of `build number = 3264527301, then take 4527301

    // To ensure we can have point releases & insider builds, we're going with the following format:
    // Insider & Release builds will be YYYY.MMM.100<build number>
    // When we have a hot fix, we update the version to YYYY.MMM.110<build number>
    // If we have more hot fixes, they'll be YYYY.MMM.120<build number>, YYYY.MMM.130<build number>, & so on.

    const versionParts = packageJson.version.split('.');
    // New build is of the form `DDDHHMM` (day of year, hours, minute) (7 digits, as out of the 10 digits first three are reserved for `100` or `101` for patches).
    // Use date time for build, this way all subsequent builds are incremental and greater than the others before.
    // Example build for 3Jan 12:45 will be `0031245`, and 16 Feb 8:50 will be `0470845`
    const today = getBuildDate();
    const dayCount = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
    const dayOfYear = dayCount[today.getMonth()] + today.getDate() + 1;
    const buildNumberSuffix = `${dayOfYear.toString().padStart(3, '0')}${(today.getHours() + 1)
        .toString()
        .padStart(2, '0')}${today.getMinutes().toString().padStart(2, '0')}`;
    const buildNumber = `${versionParts[2].substring(0, 3)}${buildNumberSuffix}`;
    const newVersion =
        versionParts.length > 1 ? `${versionParts[0]}.${versionParts[1]}.${buildNumber}` : packageJson.version;
    packageJson.version = newVersion;
    console.log('Build Number', newVersion);
    // Write back to the package json
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 4), 'utf-8');
}

updateBuildNumber()
