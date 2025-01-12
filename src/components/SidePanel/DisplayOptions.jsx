/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { CollapsibleGroup, colors, Toggle } from 'pc-nrfconnect-shared';

import {
    chartState,
    toggleDigitalChannels,
    toggleTimestamps,
} from '../../reducers/chartReducer';
import { isDataLoggerPane } from '../../utils/panes';
import DigitalChannels from './DigitalChannels';

const { gray700, nordicBlue } = colors;

export default () => {
    const dispatch = useDispatch();
    const { digitalChannelsVisible, timestampsVisible, hasDigitalChannels } =
        useSelector(chartState);
    const isDataLogger = useSelector(isDataLoggerPane);

    return (
        <CollapsibleGroup heading="Display options" defaultCollapsed={false}>
            <Toggle
                onToggle={() => dispatch(toggleTimestamps())}
                isToggled={timestampsVisible}
                label="Timestamps"
                variant="secondary"
                barColor={gray700}
                barColorToggled={nordicBlue}
            />
            {hasDigitalChannels && isDataLogger && (
                <>
                    <Toggle
                        onToggle={() => dispatch(toggleDigitalChannels())}
                        isToggled={digitalChannelsVisible}
                        label="Digital channels"
                        variant="secondary"
                        barColor={gray700}
                        barColorToggled={nordicBlue}
                    />
                    <DigitalChannels />
                </>
            )}
        </CollapsibleGroup>
    );
};
