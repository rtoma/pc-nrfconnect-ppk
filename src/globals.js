/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { getCurrentWindow } from '@electron/remote';

export const bufferLengthInSeconds = 60 * 5;

const samplingTime = 10;
const samplesPerSecond = 1e6 / samplingTime;

export const options = {
    samplingTime,
    samplesPerSecond,
    data: new Float32Array(samplesPerSecond * bufferLengthInSeconds),
    bits: null,
    index: 0,
    timestamp: null,
};

export const nbDigitalChannels = 8;

/**
 * Translate timestamp to index of sample array
 * @param {Number} timestamp timestamp to translate to index
 * @returns {Number} index of sample at provided timestamp
 */
export const timestampToIndex = timestamp =>
    options.index -
    ((options.timestamp - timestamp) * options.samplesPerSecond) / 1e6;

/**
 * Translate index of sample array to timestamp
 * @param {Number} index index to translate to timestamp
 * @returns {Number} timestamp of sample at provided index
 */
export const indexToTimestamp = index =>
    options.timestamp -
    ((options.index - index) * 1e6) / options.samplesPerSecond;

export const updateTitle = info => {
    const title = getCurrentWindow().getTitle().split(':')[0].trim();

    getCurrentWindow().setTitle(`${title}${info ? ':' : ''} ${info || ''}`);
};
