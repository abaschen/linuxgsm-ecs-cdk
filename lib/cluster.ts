import { Annotations, CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { FlowLog, FlowLogDestination, FlowLogResourceType, FlowLogTrafficType, IpAddresses, Peer, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Cluster, Compatibility, ContainerImage, FargatePlatformVersion, FargateService, LogDrivers, MountPoint, NetworkMode, PortMapping, Protocol, Secret, TaskDefinition, Volume } from "aws-cdk-lib/aws-ecs";
import { FileSystem } from "aws-cdk-lib/aws-efs";
import { Construct } from "constructs";
import Config from "./Config";
import { ServerTaskNestedStack } from "./server-task";
import { NetworkLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import { CfnLoadBalancer, NetworkLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ARecord, HostedZone, IHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

interface ClusterStackProps extends StackProps {
}

export class ClusterStack extends Stack {

  readonly fargateCluster: Cluster;
  readonly nlb: NetworkLoadBalancer;
  readonly vpc: Vpc;
  readonly hostedZone?: IHostedZone;
  readonly nlbSg: SecurityGroup;

  constructor(scope: Construct, id: string, props?: ClusterStackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, "vpc", {
      ipAddresses: IpAddresses.cidr('20.0.0.0/16'),
      subnetConfiguration: [
        {
          name: `${Config.prefix}ServerPublicSubnet`,
          subnetType: SubnetType.PUBLIC,
        },
        {
          name: `${Config.prefix}ServerPrivateSubnet`,
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        },
      ],
      maxAzs: 1,
      enableDnsSupport: true,
      enableDnsHostnames: true,
    });
    new FlowLog(this, 'VPCFlowLog', {
      resourceType: FlowLogResourceType.fromVpc(this.vpc),
      destination: FlowLogDestination.toCloudWatchLogs(),
      trafficType: FlowLogTrafficType.ALL,
    })
    this.fargateCluster = new Cluster(this, "fargateCluster", {
      vpc: this.vpc,
    });

    this.nlb = new NetworkLoadBalancer(this, 'NLB', {
      vpc: this.vpc,
      internetFacing: true,
    });
    this.nlbSg = new SecurityGroup(this, "NLBSecurityGroup", { vpc: this.vpc, allowAllOutbound: true });
    this.nlbSg.addIngressRule(Peer.anyIpv4(), Port.allTraffic())
    const cfnlb = this.nlb.node.defaultChild as CfnLoadBalancer;

    cfnlb.addPropertyOverride("SecurityGroups", [this.nlbSg.securityGroupId]);

    if (process.env.DOMAIN)
      // Create a DNS record in Route 53 pointing to the NLB
      this.hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
        domainName: process.env.DOMAIN
      });

    new ServerTaskNestedStack(this, "satisfactory", {
      tag: "sf",
      app: "satisfactory",
      memory: 16 * 1024,
      cpu: 4 * 1024,
      ports: {
        game: {
          port: 7777,
          protocol: Protocol.UDP
        },
        beacon: {
          port: 15000,
          protocol: Protocol.UDP
        },
        query: {
          port: 15777,
          protocol: Protocol.UDP
        }
      }

    });


  }

  name(name: string) {
    return `${Config.prefix}-${name}`;
  }
}
