/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import reducer, * as triggerActions from '../triggerReducer';

const initialState = reducer(undefined, {});

describe('triggerReducer', () => {
    describe('modify attributes', () => {
        it('should set trigger level', () => {
            const state = reducer(initialState, {
                type: triggerActions.TRIGGER_LEVEL_SET,
                triggerLevel: 5,
            });
            expect(state.triggerLevel).toEqual(5);
        });

        it('should set trigger length', () => {
            const state = reducer(initialState, {
                type: triggerActions.TRIGGER_LENGTH_SET,
                triggerLength: 37.85,
            });
            expect(state.triggerLength).toEqual(37.85);
        });

        it('should set window ranges', () => {
            const state = reducer(initialState, {
                type: triggerActions.TRIGGER_WINDOW_RANGE,
                triggerWindowRange: {
                    min: 5,
                    max: 50,
                },
            });
            expect(state.triggerWindowRange.min).toEqual(5);
            expect(state.triggerWindowRange.max).toEqual(50);
        });
    });

    describe('trigger single set', () => {
        const waitingState = reducer(initialState, {
            type: triggerActions.TRIGGER_SINGLE_SET,
        });

        it('should start trigger', () => {
            expect(waitingState.triggerSingleWaiting).toBe(true);
            expect(waitingState.triggerRunning).toBe(false);
        });

        it('should clear trigger', () => {
            const clearedState = reducer(waitingState, {
                type: triggerActions.TRIGGER_SINGLE_CLEAR,
            });
            expect(clearedState.triggerSingleWaiting).toBe(false);
        });
    });
});
