/* Copyright (c) 2015 - 2018, Nordic Semiconductor ASA
 *
 * All rights reserved.
 *
 * Use in source and binary forms, redistribution in binary form only, with
 * or without modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions in binary form, except as embedded into a Nordic
 *    Semiconductor ASA integrated circuit in a product or a software update for
 *    such product, must reproduce the above copyright notice, this list of
 *    conditions and the following disclaimer in the documentation and/or other
 *    materials provided with the distribution.
 *
 * 2. Neither the name of Nordic Semiconductor ASA nor the names of its
 *    contributors may be used to endorse or promote products derived from this
 *    software without specific prior written permission.
 *
 * 3. This software, with or without modification, must only be used with a Nordic
 *    Semiconductor ASA integrated circuit.
 *
 * 4. Any software provided in binary form under this license must not be reverse
 *    engineered, decompiled, modified and/or disassembled.
 *
 * THIS SOFTWARE IS PROVIDED BY NORDIC SEMICONDUCTOR ASA "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 * MERCHANTABILITY, NONINFRINGEMENT, AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
 * TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { logger } from 'nrfconnect/core';
import Device from '../device';

import {
    deviceOpenedAction,
    deviceClosedAction,
    rttStartAction,
    toggleDUTAction,
    setPowerModeAction,
    samplingStartAction,
    samplingStoppedAction,
} from '../reducers/appReducer';
import {
    switchingPointsResetAction,
    switchingPointsDownSetAction,
    spikeFilteringToggleAction,
} from '../reducers/switchingPointsReducer';
import {
    toggleTriggerAction,
    clearSingleTriggingAction,
    triggerLevelSetAction,
    triggerSingleSetAction,
    externalTriggerToggledAction,
} from '../reducers/triggerReducer';
import { updateRegulatorAction } from '../reducers/voltageRegulatorReducer';
import { resistorsResetAction } from '../reducers/resistorCalibrationReducer';
import { chartWindowAction, animationAction } from '../reducers/chartReducer';
import { options, bufferLengthInSeconds } from '../globals';

let device = null;
let updateRequestInterval;

function setupOptions() {
    console.log(device.capabilities);
    options.samplingTime = device.adcSamplingTimeUs;
    options.samplesPerSecond = 1e6 / options.samplingTime;
    const bufferLength = Math.trunc(options.samplesPerSecond * bufferLengthInSeconds);
    if (device.capabilities.ppkSetPowerMode) {
        if (!options.bits || options.bits.length !== bufferLength) {
            options.bits = new Uint8Array(bufferLength);
        }
    } else {
        options.bits = null;
    }
    if (options.data.length !== bufferLength) {
        options.data = new Float32Array(bufferLength);
        options.data.fill(NaN);
    }
}


/* Start reading current measurements */
export function samplingStart() {
    return async (dispatch, getState) => {
        options.data.fill(undefined);
        options.index = 0;
        dispatch(chartWindowAction(null, null, getState().app.chart.windowDuration), null, null);
        dispatch(samplingStartAction());
        await device.ppkAverageStart();
        logger.info('Average started');
    };
}

export function samplingStop() {
    return async dispatch => {
        dispatch(samplingStoppedAction());
        await device.ppkAverageStop();
        logger.info('Average stopped');
    };
}

export function triggerStop() {
    return async dispatch => {
        logger.info('Stopping trigger');
        await device.ppkTriggerStop();
        dispatch(toggleTriggerAction(false));
        dispatch(clearSingleTriggingAction());
    };
}

export function close() {
    return async (dispatch, getState) => {
        clearInterval(updateRequestInterval);
        if (!device) {
            return;
        }
        if (getState().app.app.samplingRunning) {
            await dispatch(samplingStop());
        }
        if (getState().app.trigger.triggerRunning) {
            await dispatch(triggerStop());
        }
        await device.stop();
        device.removeAllListeners();
        device = null;
        dispatch(deviceClosedAction());
        logger.info('PPK closed');
    };
}

export function open(deviceInfo) {
    return async (dispatch, getState) => {
        if (getState().app.portName) {
            await dispatch(close());
        }

        const onSample = ({
            value, bits, timestamp, trigger,
        }) => {
            const { samplingRunning } = getState().app.app;
            const { windowBegin, windowEnd } = getState().app.chart;
            if (!samplingRunning && !trigger) {
                // skip incoming data after stopped
                return;
            }

            if (timestamp) {
                let avgts = options.timestamp;
                while (avgts < timestamp - options.samplingTime) {
                    avgts += options.samplingTime;
                    options.data[options.index] = undefined;
                    options.index += 1;
                    if (options.index === options.data.length) {
                        options.index = 0;
                    }
                }
                options.data[options.index] = value;
                options.index += 1;
                options.timestamp = timestamp;
            } else {
                options.data[options.index] = value;
                options.bits[options.index] = bits;
                options.index += 1;
                options.timestamp += options.samplingTime;
            }

            if ((windowBegin !== 0 || windowEnd !== 0)
                && options.timestamp >= windowBegin + (bufferLengthInSeconds * 1e6)) {
                // stop average when reaches end of buffer (i.e. would overwrite chart data)
                dispatch(samplingStop());
                return;
            }

            if (options.index === options.data.length) {
                options.index = 0;
            }
        };

        try {
            device = new Device(deviceInfo, onSample);
            setupOptions(device);
            const metadata = device.parseMeta(await device.start());

            console.log(metadata);
            dispatch(resistorsResetAction(metadata));
            dispatch(switchingPointsResetAction(metadata));
            dispatch(updateRegulatorAction(metadata));
            dispatch(rttStartAction());
            logger.info('PPK started');
        } catch (err) {
            logger.error('Failed to start the PPK.');
            logger.debug(err);
            dispatch({ type: 'DEVICE_DESELECTED' });
        }

        dispatch(deviceOpenedAction(deviceInfo.serialNumber, device.capabilities));
        logger.info('PPK opened');

        device.on('error', (message, error) => {
            logger.error(message);
            if (error) {
                dispatch(close());
                logger.debug(error);
            }
        });

        clearInterval(updateRequestInterval);
        updateRequestInterval = setInterval(() => {
            if (options.renderIndex !== options.index) {
                requestAnimationFrame(() => dispatch(animationAction()));
                options.renderIndex = options.index;
            }
        }, 10);
    };
}

export function updateRegulator() {
    return async (dispatch, getState) => {
        const { vdd } = getState().app.voltageRegulator;
        await device.ppkUpdateRegulator(vdd);
        dispatch(updateRegulatorAction({ currentVdd: vdd }));
    };
}


/**
 * Takes the window value in milliseconds, adjusts for microsecs
 * and resolves the number of bytes we need for this size of window.
 * @param {number} value  Value received in milliseconds
 * @returns {null} Nothing
 */
export function triggerUpdateWindow(value) {
    return async () => {
        const triggerWindowMicroSec = value * 1000;
        const triggerWindow = triggerWindowMicroSec / options.samplingTime;
        // If division returns a decimal, round downward to nearest integer
        await device.ppkTriggerWindowSet(Math.floor(triggerWindow));
        logger.info('Trigger window updated');
    };
}

export function triggerSet(triggerLevel) {
    /* eslint-disable no-bitwise */
    return async dispatch => {
        logger.info('Trigger level set: ', triggerLevel, 'uA');
        const high = (triggerLevel >> 16) & 0xFF;
        const mid = (triggerLevel >> 8) & 0xFF;
        const low = triggerLevel & 0xFF;
        await device.ppkTriggerSet(high, mid, low);

        dispatch(triggerLevelSetAction(triggerLevel));
    };
}

export function triggerStart() {
    return async (dispatch, getState) => {
        // Start trigger
        const { triggerLevel } = getState().app.trigger;

        logger.info('Starting trigger');
        dispatch(toggleTriggerAction(true));
        dispatch(clearSingleTriggingAction());
        dispatch(triggerSet(triggerLevel));
    };
}

export function triggerSingleSet() {
    return async (dispatch, getState) => {
        const { triggerLevel } = getState().app.trigger;
        const high = (triggerLevel >> 16) & 0xFF;
        const mid = (triggerLevel >> 8) & 0xFF;
        const low = triggerLevel & 0xFF;

        await device.ppkTriggerSingleSet(high, mid, low);
        dispatch(triggerSingleSetAction());
    };
}

export function toggleDUT(isOn) {
    return async dispatch => {
        await device.ppkToggleDUT(isOn ? 0 : 1);
        logger.info(`DUT ${isOn ? 'ON' : 'OFF'}`);
        dispatch(toggleDUTAction());
    };
}

export function setPowerMode(isSmuMode) {
    return async dispatch => {
        await device.ppkSetPowerMode(isSmuMode ? 0 : 1);
        logger.info(`Mode: ${isSmuMode ? 'Amperemeter' : 'SMU'}`);
        dispatch(setPowerModeAction());
    };
}

export function updateResistors() {
    return async (_, getState) => {
        const { userResLo, userResMid, userResHi } = getState().app.resistorCalibration;
        await device.ppkUpdateResistors(userResLo, userResMid, userResHi);
    };
}

export function resetResistors() {
    return async (dispatch, getState) => {
        const { resLo, resMid, resHi } = getState().app.resistorCalibration;
        await device.ppkUpdateResistors(resLo, resMid, resHi);
        dispatch(resistorsResetAction());
    };
}

export function externalTriggerToggled(chbState) {
    return async dispatch => {
        if (chbState) {
            await device.ppkTriggerStop();
        }
        await device.ppkTriggerExtToggle();
        dispatch(externalTriggerToggledAction());
    };
}

export function spikeFilteringToggle() {
    return async (dispatch, getState) => {
        if (getState().app.switchingPoints.spikeFiltering === false) {
            await device.ppkSpikeFilteringOn();
        } else {
            await device.ppkSpikeFilteringOff();
        }
        dispatch(spikeFilteringToggleAction());
    };
}

export function switchingPointsUpSet() {
    return async (_, getState) => {
        const { switchUpSliderPosition } = getState().app.switchingPoints;
        const pot = 13500.0 * ((((10.98194 * switchUpSliderPosition) / 1000) / 0.41) - 1);
        await device.ppkSwitchPointUp(parseInt((pot), 10));
    };
}

export function switchingPointsDownSet() {
    return async (dispatch, getState) => {
        const { switchDownSliderPosition } = getState().app.switchingPoints;
        const pot = (2000.0 * (((16.3 * (500 - switchDownSliderPosition)) / 100.0) - 1)) - 30000.0;
        await device.ppkSwitchPointDown(parseInt((pot / 2), 10));
        dispatch(switchingPointsDownSetAction(switchDownSliderPosition));
    };
}

export function switchingPointsReset() {
    return async dispatch => {
        // Reset state of slider to initial values
        dispatch(switchingPointsResetAction());
        // Set these initial values in hardware
        await dispatch(switchingPointsUpSet());
        await dispatch(switchingPointsDownSet());
    };
}
