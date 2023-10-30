// Import main CDK library as cdk
import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';

import { IManagedPolicy, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { readdirSync } from 'fs';
import { NodetsLayer, NodetsFunction, NodetsFunctionProps } from '@aws-abaschen/cdk-typescript';

interface SteamServerStackProps extends StackProps {
  readonly app: string
  readonly defaultRemovalPolicy?: RemovalPolicy
}

export class SteamServerStack extends Stack {
  layers: { [key: string]: LayerVersion }
  app: string
  lambdaManagedPolicy?: IManagedPolicy

  constructor(scope: Construct, id: string, props: SteamServerStackProps) {
    super(scope, id, props);
    this.app = props.app;
    // retrieve the minimal managed policy for the lambda functions to provide VPC Access, remove this line if unwanted
    this.lambdaManagedPolicy = ManagedPolicy.fromManagedPolicyArn(this, 'AWSLambdaVPCAccessExecutionRole', 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole');
    //build layers
    this.buildLayers();

    /**
     * Example of lambda creation
     */
    const lambdaDefault: Partial<NodetsFunctionProps> = {
      //      vpc,
      //      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      //      securityGroups: [lambdaSecurityGroup],
    };
    const name = 'discord-pong';
    new NodetsFunction(this, name, {
      ...lambdaDefault,
      description: 'A lambda example with a layer to answer to discord bot interaction with pong',
      layers: [this.layers['discord-authorizer']],
      parameters: ['DB-USER'],
      environment: {
        TEST_1: 'test Value 1'
      }
    });

    new NodetsFunction(this, 'return-200', {
      ...lambdaDefault,
      description: 'always return 200',
    });

  }

  buildLayers() {
    this.layers = readdirSync('src/layers', { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .reduce<{ [key: string]: LayerVersion }>((map, name) => {
        /*Create Layer for each directory*/
        const layer = new NodetsLayer(this, `${name}-layer`, { name });
        return {
          ...map,
          [name]: layer
        };
      }, {});
  }
}