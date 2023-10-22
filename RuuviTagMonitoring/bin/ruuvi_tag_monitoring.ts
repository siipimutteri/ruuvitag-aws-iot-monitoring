#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RuuviTagMonitoringStack } from '../lib/ruuvi_tag_monitoring-stack';

const app = new cdk.App();

new RuuviTagMonitoringStack(app, 'RuuviTagMonitoringStack', {
  env: {
    region: 'eu-north-1'
  },
  thingName: 'RaspberryPi',
  iotTopicPrefix: 'ruuvitag',
  cloudWatchMetricNameSpace: 'RuuviTag',
  ruuviTagId: 'f3d619998f38',
});