/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { fork } from 'child_process';
import path from 'path';
import { getAppDir, logger } from 'pc-nrfconnect-shared';

import PPKCmd from '../constants';
import Device, { convertFloatToByteBuffer } from './abstractDevice';

/* eslint-disable no-bitwise */

const generateMask = (bits, pos) => ({ pos, mask: (2 ** bits - 1) << pos });
const MEAS_ADC = generateMask(14, 0);
const MEAS_RANGE = generateMask(3, 14);
const MEAS_COUNTER = generateMask(6, 18);
const MEAS_LOGIC = generateMask(8, 24);

const MAX_PAYLOAD_COUNTER = 0b111111; // 0x3f, 64 - 1
const DATALOSS_THRESHOLD = 500; // 500 * 10us = 5ms: allowed loss

const getMaskedValue = (value, { mask, pos }) => (value & mask) >> pos;

class SerialDevice extends Device {
    adcMult = 1.8 / 163840;

    modifiers = {
        r: [1031.64, 101.65, 10.15, 0.94, 0.043],
        gs: [1, 1, 1, 1, 1],
        gi: [1, 1, 1, 1, 1],
        o: [0, 0, 0, 0, 0],
        s: [0, 0, 0, 0, 0],
        i: [0, 0, 0, 0, 0],
        ug: [1, 1, 1, 1, 1],
    };

    adcSamplingTimeUs = 10;

    resistors = { hi: 1.8, mid: 28, lo: 500 };

    vddRange = { min: 800, max: 5000 };

    triggerWindowRange = { min: 1, max: 100 };

    isRunningInitially = false;

    constructor(deviceInfo) {
        super();

        this.capabilities.maxContinuousSamplingTimeUs = this.adcSamplingTimeUs;
        this.capabilities.samplingTimeUs = this.adcSamplingTimeUs;
        this.capabilities.digitalChannels = true;
        this.capabilities.prePostTriggering = true;
        this.spikeFilter = {
            alpha: 0.18,
            alpha5: 0.06,
            samples: 3,
        };
        this.path = deviceInfo.serialport.comName;
        this.child = fork(
            path.resolve(getAppDir(), 'worker', 'serialDevice.js')
        );
        this.parser = null;
        this.resetDataLossCounter();

        this.child.on('message', m => {
            if (!this.parser) {
                console.error('Program logic error, parser is not set.');
                return;
            }
            if (m.data) {
                this.parser(Buffer.from(m.data));
                return;
            }
            console.log(`message: ${JSON.stringify(m)}`);
        });
        this.child.on('close', code => {
            if (code) {
                console.log(`Child process exited with code ${code}`);
            } else {
                console.log('Child process cleanly exited');
            }
        });
    }

    resetDataLossCounter() {
        this.expectedCounter = null;
        this.dataLossCounter = 0;
        this.corruptedSamples = [];
    }

    getAdcResult(range, adcVal) {
        const resultWithoutGain =
            (adcVal - this.modifiers.o[range]) *
            (this.adcMult / this.modifiers.r[range]);
        let adc =
            this.modifiers.ug[range] *
            (resultWithoutGain *
                (this.modifiers.gs[range] * resultWithoutGain +
                    this.modifiers.gi[range]) +
                (this.modifiers.s[range] * (this.currentVdd / 1000) +
                    this.modifiers.i[range]));

        const prevRollingAvg4 = this.rollingAvg4;
        const prevRollingAvg = this.rollingAvg;

        this.rollingAvg =
            this.rollingAvg === undefined
                ? adc
                : this.spikeFilter.alpha * adc +
                  (1.0 - this.spikeFilter.alpha) * this.rollingAvg;
        this.rollingAvg4 =
            this.rollingAvg4 === undefined
                ? adc
                : this.spikeFilter.alpha5 * adc +
                  (1.0 - this.spikeFilter.alpha5) * this.rollingAvg4;

        if (this.prevRange === undefined) {
            this.prevRange = range;
        }

        if (this.prevRange !== range || this.afterSpike > 0) {
            if (this.prevRange !== range) {
                // number of measurements after the spike which still to be averaged
                this.consecutiveRangeSample = 0;
                this.afterSpike = this.spikeFilter.samples;
            } else {
                this.consecutiveRangeSample += 1;
            }
            // Use previous rolling average if within first two samples of range 4
            if (range === 4) {
                if (this.consecutiveRangeSample < 2) {
                    this.rollingAvg4 = prevRollingAvg4;
                    this.rollingAvg = prevRollingAvg;
                }
                adc = this.rollingAvg4;
            } else {
                adc = this.rollingAvg;
            }
            // adc = range === 4 ? this.rollingAvg4 : this.rollingAvg;
            this.afterSpike -= 1;
        }
        this.prevRange = range;

        return adc;
    }

    start() {
        this.child.send({ open: this.path });
        return this.getMetadata();
    }

    parseMeta(m) {
        Object.keys(this.modifiers).forEach(k => {
            for (let i = 0; i < 5; i += 1) {
                this.modifiers[k][i] = m[`${k}${i}`] || this.modifiers[k][i];
            }
        });
        return m;
    }

    stop() {
        this.child.kill();
    }

    sendCommand(cmd) {
        if (cmd.constructor !== Array) {
            this.emit(
                'error',
                'Unable to issue command',
                'Command is not an array'
            );
            return undefined;
        }
        if (cmd[0] === PPKCmd.AverageStart) {
            this.rollingAvg = undefined;
            this.rollingAvg4 = undefined;
            this.prevRange = undefined;
            this.consecutiveRangeSample = 0;
            this.afterSpike = 0;
        }
        this.child.send({ write: cmd });
        return Promise.resolve(cmd.length);
    }

    dataLossReport(missingSamples) {
        if (
            this.dataLossCounter < DATALOSS_THRESHOLD &&
            this.dataLossCounter + missingSamples >= DATALOSS_THRESHOLD
        ) {
            logger.error(
                'Data loss detected. See https://github.com/Nordicsemiconductor/pc-nrfconnect-ppk/blob/master/doc/troubleshooting.md#data-loss-with-ppk2'
            );
        }
        this.dataLossCounter += missingSamples;
    }

    handleRawDataSet(adcValue) {
        try {
            const currentMeasurementRange = Math.min(
                getMaskedValue(adcValue, MEAS_RANGE),
                this.modifiers.r.length
            );
            const counter = getMaskedValue(adcValue, MEAS_COUNTER);
            const adcResult = getMaskedValue(adcValue, MEAS_ADC) * 4;
            const bits = getMaskedValue(adcValue, MEAS_LOGIC);
            const value =
                this.getAdcResult(currentMeasurementRange, adcResult) * 1e6;

            if (this.expectedCounter === null) {
                this.expectedCounter = counter;
            } else if (
                this.corruptedSamples.length > 0 &&
                counter === this.expectedCounter
            ) {
                while (this.corruptedSamples.length > 0) {
                    this.onSampleCallback(this.corruptedSamples.shift());
                }
                this.corruptedSamples = [];
            } else if (this.corruptedSamples.length > 4) {
                const missingSamples =
                    (counter - this.expectedCounter + MAX_PAYLOAD_COUNTER) &
                    MAX_PAYLOAD_COUNTER;
                this.dataLossReport(missingSamples);
                for (let i = 0; i < missingSamples; i += 1) {
                    this.onSampleCallback({});
                }
                this.expectedCounter = counter;
                this.corruptedSamples = [];
            } else if (this.expectedCounter !== counter) {
                this.corruptedSamples.push({ value, bits });
            }

            this.expectedCounter += 1;
            this.expectedCounter &= MAX_PAYLOAD_COUNTER;
            // Only fire the event, if the buffer data is valid
            this.onSampleCallback({ value, bits });
        } catch (err) {
            console.log(err.message, 'original value', adcValue);
            // to keep timestamp consistent, undefined must be emitted
            this.onSampleCallback({});
        }
    }

    remainder = Buffer.alloc(0);

    parseMeasurementData(buf) {
        const sampleSize = 4;
        let ofs = this.remainder.length;
        const first = Buffer.concat(
            [this.remainder, buf.subarray(0, sampleSize - ofs)],
            sampleSize
        );
        ofs = sampleSize - ofs;
        this.handleRawDataSet(first.readUIntLE(0, sampleSize));
        for (; ofs <= buf.length - sampleSize; ofs += sampleSize) {
            this.handleRawDataSet(buf.readUIntLE(ofs, sampleSize));
        }
        this.remainder = buf.subarray(ofs);
    }

    getMetadata() {
        let metadata = '';
        return (
            new Promise(resolve => {
                this.parser = data => {
                    metadata = `${metadata}${data}`;
                    if (metadata.includes('END')) {
                        // hopefully we have the complete string, HW is the last line
                        this.parser = this.parseMeasurementData.bind(this);
                        resolve(metadata);
                    }
                };
                this.sendCommand([PPKCmd.GetMetadata]);
            })
                // convert output string json:
                .then(m =>
                    m
                        .replace('END', '')
                        .trim()
                        .toLowerCase()
                        .replace(/-nan/g, 'null')
                        .replace(/\n/g, ',\n"')
                        .replace(/: /g, '": ')
                )
                .then(m => `{"${m}}`)
                // resolve with parsed object:
                .then(JSON.parse)
        );
    }

    // Capability methods

    ppkSetPowerMode(isSmuMode) {
        return this.sendCommand([PPKCmd.SetPowerMode, isSmuMode ? 2 : 1]);
    }

    ppkSetUserGains(range, gain) {
        this.modifiers.ug[range] = gain;
        return this.sendCommand([
            PPKCmd.SetUserGains,
            range,
            ...convertFloatToByteBuffer(gain),
        ]);
    }

    ppkSetSpikeFilter(spikeFilter) {
        this.spikeFilter = {
            ...this.spikeFilter,
            ...spikeFilter,
        };
    }

    ppkAverageStart() {
        this.resetDataLossCounter();
        return super.ppkAverageStart();
    }

    ppkTriggerSet() {
        return this.ppkAverageStart();
    }

    ppkTriggerStop() {
        return this.ppkAverageStop();
    }

    ppkTriggerSingleSet() {
        return this.ppkAverageStart();
    }
}

export default SerialDevice;
