import { Protocol } from "aws-cdk-lib/aws-ecs";

export interface SteamServerConfig{
    app: string,
    tag: string,
    cpu: number,
    memory: number,
    environment?: {[key: string]: string},
    ports: {[key: string]: {port: number, protocol: Protocol}}
}