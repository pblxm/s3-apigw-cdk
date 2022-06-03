#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MyStack } from './lib/cdk-stack';

const app = new cdk.App();
const back = new MyStack(app, 'MyStack', {});