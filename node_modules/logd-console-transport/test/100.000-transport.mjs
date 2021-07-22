'use strict';

import Transport from '../';
import logd from 'logd';
import section, {SpecReporter} from 'section-tests';
import Argv from './lib/Argv.mjs';

const argv = new Argv();


section('Transport', (section) => {

    section.test('Instantiate the transport', async() => {
        new Transport();
    });

    section.test('Register the transport on the logger', async() => {
        logd.transport(new Transport());
    });

    section.test('print a message', async() => {
        argv.add('--log-level=0+');
        argv.add('--log-module=test');

        const localLog = logd.createInstance();
        localLog.transport(new Transport());
        
        localLog.module('test').warn('testing this', {hui: 6}, new Error(1));
        
        argv.clear();
    });
});