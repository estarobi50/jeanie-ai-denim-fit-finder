#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { JeanieStack } from '../lib/jeanie-stack';

const app = new cdk.App();

new JeanieStack(app, 'JeanieStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // CloudFront + WAF require us-east-1 for the WebACL. Keep the whole stack there for simplicity.
    region: 'us-east-1',
  },
  description: 'Jeanie AI denim-fit recommender — S3+CloudFront frontend, Lambda+APIGW backend',
});
