/*
 * Copyright (c) 2022 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useState } from 'react';
import ToggleButton from 'react-bootstrap/ToggleButton';
import ToggleButtonGroup from 'react-bootstrap/ToggleButtonGroup';
import { logger } from 'pc-nrfconnect-shared';
import { bool, func, number } from 'prop-types';

import { options, timestampToIndex } from '../../globals';

const ExportSelection = ({
    isExportDialogVisible,
    setIndexBegin,
    setIndexEnd,
    windowBegin,
    windowEnd,
    cursorBegin,
    cursorEnd,
    windowDuration,
}) => {
    const setExportIndexes = (begin, end) => {
        setIndexBegin(begin);
        setIndexEnd(end);
    };

    const updateRadioSelected = value => {
        switch (value) {
            case 0:
                setRadioValue(0);
                exportSelection[0].onSelect();
                break;
            case 1:
                setRadioValue(1);
                exportSelection[1].onSelect();
                break;
            case 2:
                setRadioValue(2);
                exportSelection[2].onSelect();
                break;
            default:
                logger.error(`Unexpected radio selected: ${value}`);
        }
    };

    const [radioValue, setRadioValue] = useState(0);
    const exportSelection = [
        {
            name: 'All',
            value: 0,
            id: 'radio-export-all',
            onSelect: () => {
                setExportIndexes(0, options.index);
            },
        },
        {
            name: 'Window',
            value: 1,
            id: 'radio-export-window',
            onSelect: () => {
                /* If no windowEnd is provided, then assume you want the last timestamp recorded.
                If no windowBegin, take calculate beginning of window by subtracting the "size" of
                the window from the end.
                At last, if the starting point is less than zero, start at index zero instead.
                */
                const end = windowEnd || options.timestamp;
                const start = windowBegin || end - windowDuration;
                setExportIndexes(
                    Math.ceil(timestampToIndex(start < 0 ? 0 : start)),
                    Math.floor(timestampToIndex(end))
                );
            },
        },
        {
            name: 'Selected',
            value: 2,
            id: 'radio-export-selected',
            onSelect: () => {
                setExportIndexes(
                    Math.ceil(timestampToIndex(cursorBegin)),
                    Math.floor(timestampToIndex(cursorEnd))
                );
            },
        },
    ];

    useEffect(() => {
        if (cursorBegin != null) {
            updateRadioSelected(2);
        } else {
            updateRadioSelected(0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isExportDialogVisible]);

    return (
        <>
            <h2>Area to export</h2>
            <ToggleButtonGroup
                type="radio"
                name="radio-export"
                className="radio-export"
                value={radioValue}
            >
                {exportSelection
                    .filter(radio => radio.value !== 2 || cursorBegin != null)
                    .map(radio => (
                        <ToggleButton
                            id={radio.id}
                            key={radio.id}
                            value={radio.value}
                            type="radio"
                            variant={
                                radioValue === radio.value ? 'set' : 'unset'
                            }
                            checked={radioValue === radio.value}
                            onChange={() => updateRadioSelected(radio.value)}
                        >
                            {radio.name}
                        </ToggleButton>
                    ))}
            </ToggleButtonGroup>{' '}
        </>
    );
};

ExportSelection.propTypes = {
    isExportDialogVisible: bool.isRequired,
    setIndexBegin: func.isRequired,
    setIndexEnd: func.isRequired,
    windowBegin: number,
    windowEnd: number,
    cursorBegin: number,
    cursorEnd: number,
    windowDuration: number,
};

export default ExportSelection;
