/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useRef, useState } from 'react';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Modal from 'react-bootstrap/Modal';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Row from 'react-bootstrap/Row';
import { useDispatch, useSelector } from 'react-redux';
import { dialog } from '@electron/remote';
import * as mathjs from 'mathjs';
import { dirname, join } from 'path';
import { Toggle } from 'pc-nrfconnect-shared';

import exportChart from '../../actions/exportChartAction';
import { indexToTimestamp } from '../../globals';
import { appState, hideExportDialog } from '../../reducers/appReducer';
import { chartState } from '../../reducers/chartReducer';
import { getLastSaveDir, setLastSaveDir } from '../../utils/persistentStore';
import ExportSelection from './ExportSelection';

import './saveexport.scss';

const { unit } = mathjs;

const useToggledSetting = (initialState, label) => {
    const [value, setValue] = useState(initialState);

    const ToggleComponent = () => (
        <div className="export-toggle">
            <Toggle
                onToggle={() => setValue(!value)}
                isToggled={value}
                label={label}
                variant="secondary"
            />
        </div>
    );
    return [value, ToggleComponent];
};

const calculateTotalSize = (
    [timestampToggled, currentToggled, bitsToggled, bitsSeparatedToggled],
    numberOfRecords
) => {
    const recordLength =
        timestampToggled * 10 +
        currentToggled * 10 +
        bitsToggled * 8 +
        bitsSeparatedToggled * 16;
    return mathjs
        .to(unit(recordLength * numberOfRecords, 'bytes'), 'MB')
        .format({ notation: 'fixed', precision: 0 });
};

const createFileName = () => {
    const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
    return join(getLastSaveDir(), `ppk-${now}.csv`);
};

export default () => {
    const dispatch = useDispatch();
    const {
        windowBegin,
        windowEnd,
        cursorBegin,
        cursorEnd,
        windowDuration,
        hasDigitalChannels,
    } = useSelector(chartState);
    const { isExportDialogVisible } = useSelector(appState);

    const [indexBegin, setIndexBegin] = useState(null);
    const [indexEnd, setIndexEnd] = useState(null);
    const [numberOfRecords, setNumberOfRecords] = useState(null);
    const [fileSize, setFileSize] = useState(null);
    const [duration, setDuration] = useState(0);
    const [formattedDuration, setFormattedDuration] = useState('');

    const [timestampToggled, TimestampToggle] = useToggledSetting(
        true,
        'Timestamp'
    );
    const [currentToggled, CurrentToggle] = useToggledSetting(true, 'Current');
    const [bitsToggled, BitsToggle] = useToggledSetting(
        hasDigitalChannels,
        'Digital logic pins (single string field)'
    );
    const [bitsSeparatedToggled, BitsSeparatedToggle] = useToggledSetting(
        false,
        'Digital logic pins (separate fields)'
    );
    const contentSelection = [
        timestampToggled,
        currentToggled,
        bitsToggled,
        bitsSeparatedToggled,
    ];
    const cancel = useRef(false);
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    useEffect(() => {
        setProgress(0);
        if (isExportDialogVisible) {
            cancel.current = false;
        }
    }, [isExportDialogVisible]);

    useEffect(() => {
        const records = indexEnd - indexBegin + 1 || 0;
        setNumberOfRecords(records);
        setFileSize(calculateTotalSize(contentSelection, records));
        setDuration(indexToTimestamp(indexEnd) - indexToTimestamp(indexBegin));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [indexBegin, indexEnd]);

    useEffect(() => {
        setFormattedDuration(
            unit(duration, 'us')
                .format({
                    notation: 'auto',
                    precision: 4,
                })
                .replace('u', '\u00B5')
        );
    }, [duration]);
    const filename = createFileName();
    const close = () => {
        cancel.current = true;
        dispatch(hideExportDialog());
    };
    const saveFile = async () => {
        const { filePath: fn } = await dialog.showSaveDialog({
            defaultPath: filename,
        });
        if (!fn) return;
        setLastSaveDir(dirname(fn));
        setExporting(true);
        dispatch(
            exportChart(
                fn,
                indexBegin,
                indexEnd,
                contentSelection,
                setProgress,
                setExporting,
                cancel
            )
        );
    };
    return (
        <Modal
            show={isExportDialogVisible}
            className="export-dialog"
            onHide={close}
        >
            <Modal.Header closeButton>
                <Modal.Title>Export selection to CSV</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <Row className="export-settings">
                    <Col sm={8}>
                        <Card className="h-100">
                            <Card.Body>
                                <ExportSelection
                                    isExportDialogVisible={
                                        isExportDialogVisible
                                    }
                                    setIndexBegin={setIndexBegin}
                                    setIndexEnd={setIndexEnd}
                                    windowBegin={windowBegin}
                                    windowEnd={windowEnd}
                                    cursorBegin={cursorBegin}
                                    cursorEnd={cursorEnd}
                                    windowDuration={windowDuration}
                                />
                                <h2>Export fields</h2>
                                <div className="w-fit-content">
                                    <TimestampToggle />
                                    <CurrentToggle />
                                    {hasDigitalChannels && (
                                        <>
                                            <BitsToggle />
                                            <BitsSeparatedToggle />
                                        </>
                                    )}
                                </div>
                            </Card.Body>
                        </Card>
                    </Col>
                    <Col sm={4}>
                        <Card className="h-100">
                            <Card.Body>
                                <h2>Estimation</h2>
                                <p>{numberOfRecords} records</p>
                                <p>{fileSize}</p>
                                <p>{formattedDuration}</p>
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
                <ProgressBar now={progress} animated className="mt-4" />
            </Modal.Body>
            <Modal.Footer>
                <Button
                    variant="primary"
                    onClick={saveFile}
                    disabled={exporting}
                >
                    Save
                </Button>
                <Button variant="secondary" onClick={close}>
                    Close
                </Button>
            </Modal.Footer>
        </Modal>
    );
};
