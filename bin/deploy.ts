#!/usr/bin/env node
import { ResourceAspect } from "@aws-abaschen/cdk-typescript";
import { App, Aspects, RemovalPolicy } from "aws-cdk-lib";
import { config } from "dotenv";
import { ClusterStack } from "lib/cluster";
import "source-map-support/register";
config();


const stackDefaults = {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.AWS_REGION },
  }
const app = new App({

});
const appName = 'steamserver';
const base = new ClusterStack(app, 'steamserver-stack', {
    ...stackDefaults
});

Aspects.of(app).add(new ResourceAspect({
    removalPolicy: RemovalPolicy.DESTROY,
    app: appName
}));

app.synth();