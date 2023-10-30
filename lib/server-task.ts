import { Annotations, CfnOutput, Duration, NestedStack, NestedStackProps, RemovalPolicy, Tag, Tags } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { SteamServerConfig } from "./SteamServerConfig";
import { ClusterStack } from "./cluster";
import { Cluster, Compatibility, ContainerImage, FargatePlatformVersion, FargateService, ListenerConfig, LogDrivers, MountPoint, NetworkMode, PortMapping, Protocol, Secret, TaskDefinition, Volume } from "aws-cdk-lib/aws-ecs";
import Config from "./Config";
import { Peer, Port, SecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2";
import { NetworkListenerAction, NetworkTargetGroup, Protocol as ProtocolELB, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { BackupPlan, BackupPlanRule, BackupResource } from "aws-cdk-lib/aws-backup";
import { Schedule } from "aws-cdk-lib/aws-events";
import { FileSystem } from "aws-cdk-lib/aws-efs";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { AnyPrincipal, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup } from "aws-cdk-lib/aws-logs";

interface ServerTaskNestedStackProps extends NestedStackProps, SteamServerConfig {

    backup?: Bucket;
}


export class ServerTaskNestedStack extends NestedStack {
    readonly storage: FileSystem;
    readonly fargateService: FargateService;
    readonly app: string;
    readonly fargateSG: SecurityGroup;

    constructor(scope: ClusterStack, id: string, props: ServerTaskNestedStackProps) {
        super(scope, id, props);

        this.app = props.app;
        this.storage = new FileSystem(this, this.name("Storage"), {
            vpc: scope.vpc,
            encrypted: true,
        });
        this.storage.addToResourcePolicy(
            new PolicyStatement({
                actions: ['elasticfilesystem:ClientMount'],
                principals: [new AnyPrincipal()],
                conditions: {
                    Bool: {
                        'elasticfilesystem:AccessedViaMountTarget': 'true'
                    }
                }
            })
        )
        const serverVolumeConfig: Volume = {
            name: this.name(`ServerVolume`),
            efsVolumeConfiguration: {
                fileSystemId: this.storage.fileSystemId,
            },
        };
        const logGroup = new LogGroup(this, this.name('task'), {
            logGroupName: this.name('task'),
            removalPolicy: RemovalPolicy.DESTROY,
        });
        const mountPoint: MountPoint = {
            containerPath: "/data",
            sourceVolume: serverVolumeConfig.name,
            readOnly: false,
        };
        const taskRole = new Role(this, this.name('taskRole'), {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
                ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly')
            ]
        });

        logGroup.grantWrite(taskRole);
        const taskDefinition = new TaskDefinition(this, this.name("TaskDefinition"), {
            compatibility: Compatibility.FARGATE,
            cpu: props.cpu.toString(),
            memoryMiB: props.memory.toString(),
            volumes: [serverVolumeConfig],
            networkMode: NetworkMode.AWS_VPC,
            taskRole
        });

        const container = taskDefinition.addContainer("serverContainer", {
            image: ContainerImage.fromRegistry(`gameservermanagers/gameserver:${props.tag}`),
            cpu: props.cpu,
            memoryLimitMiB: props.memory,
            logging: LogDrivers.awsLogs({ logGroup, streamPrefix: props.app }),
            healthCheck: {
                command: [ "CMD-SHELL", "/app/entrypoint-healthcheck.sh || exit 1"],
            },
            environment: {
                ...props.environment
            },
            portMappings: [...Object.values(props.ports).map(({ port, protocol }) => {
                return {
                    containerPort: port,
                    hostPort: port,
                    protocol
                };

            }), {
                hostPort: 65534, containerPort: 65534, protocol: Protocol.TCP
            }]
        });
        console.log(JSON.stringify(container.portMappings));
        taskDefinition.addContainer("healthcheck", {
            image: ContainerImage.fromRegistry(`nginx:latest`),
            essential: true,
            logging: LogDrivers.awsLogs({ logGroup, streamPrefix: props.app }),
            healthCheck: {
                command: [ "CMD-SHELL", "wget -O /dev/null http://localhost:8080 || exit 1"],
            },
            portMappings: [
                {
                    containerPort: 8080,
                    hostPort: 8080,
                    protocol: Protocol.TCP
                }
            ]
        });


        container.addMountPoints(mountPoint);
        this.fargateSG = new SecurityGroup(this, this.name("fargateSecurityGroup"), { vpc: scope.vpc, allowAllOutbound: true });

        this.fargateService = new FargateService(this, this.name(`fargate-service`), {
            cluster: scope.fargateCluster,
            taskDefinition,
            desiredCount: 0,
            securityGroups: [this.fargateSG],
            vpcSubnets: scope.vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS })
        });


        // Allow access to EFS from Fargate ECS
        this.storage.grantRootAccess(taskDefinition.taskRole.grantPrincipal);
        this.storage.connections.allowDefaultPortFrom(this.fargateService.connections);

        Object.entries(props.ports).forEach(([key, { port, protocol }]) => {

            const listener = scope.nlb.addListener(key, {
                port,
                protocol: protocol === Protocol.UDP ? ProtocolELB.UDP : ProtocolELB.TCP,
            })

            this.fargateService.registerLoadBalancerTargets({
                listener: ListenerConfig.networkListener(listener, {
                    port,
                    protocol: protocol === Protocol.UDP ? ProtocolELB.UDP : ProtocolELB.TCP,
                    healthCheck: {
                        port: "8080",
                        protocol: ProtocolELB.HTTP,
                        path: '/',
                        healthyHttpCodes: "200"
                    }
                }),
                protocol,
                containerPort: port,
                containerName: 'serverContainer',
                newTargetGroupId: key

            });

        });

        const backupPlan = new BackupPlan(this, this.name(`BackupPlan`), {
            backupPlanRules: [
                new BackupPlanRule({
                    startWindow: Duration.hours(1),
                    completionWindow: Duration.days(7),
                    deleteAfter: Duration.days(3),
                    scheduleExpression: Schedule.cron({
                        minute: '0',
                        hour: '4'
                    })
                })
            ]
        });
        backupPlan.addSelection(`BackupSelection`, {
            resources: [BackupResource.fromEfsFileSystem(this.storage)],
        });



        // Create listeners for UDP ports on the NLB
        if (scope.hostedZone) {
            new ARecord(this, this.name(`DNSRecord`), {
                zone: scope.hostedZone,
                recordName: `${props.tag}.${process.env.DOMAIN}`, // Replace with your desired subdomain
                target: RecordTarget.fromAlias(new LoadBalancerTarget(scope.nlb)),
            });

            new CfnOutput(this, `${props.app}-DNSRecord-output`, {
                value: `${props.tag}.${process.env.DOMAIN}`
            })
        }
        Object.values(props.ports).forEach(({ port, protocol }) => {
            this.fargateSG.addIngressRule(Peer.securityGroupId(scope.nlbSg.securityGroupId), protocol === Protocol.UDP ? Port.udp(port) : Port.tcp(port));
        })
        Tags.of(this).add('x-game', props.tag);
    }

    name(name: string) {
        return `${Config.prefix}-${this.app}-${name}`;
    }
}