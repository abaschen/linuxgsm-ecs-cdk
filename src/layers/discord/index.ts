import { APIGatewayEvent, APIGatewayProxyResultV2 } from 'aws-lambda';
import { APIInteractionResponseChannelMessageWithSource, APIModalInteractionResponse, APIModalInteractionResponseCallbackData, InteractionResponseType } from 'discord-api-types/v10';

import { Buffer } from 'node:buffer';
import { sign } from "tweetnacl";

if (!process.env.APP_PUBLIC_KEY) {
    process.exit(1);
}

var publicKeyBuffer = Buffer.from(process.env.APP_PUBLIC_KEY, "hex");
export const verify = async (event: APIGatewayEvent): Promise<APIGatewayProxyResultV2 | undefined> => {
    if (!event.body) {
        console.error(`Empty request body`);
        return respondWithError("invalid empty body");
    }
    const checksum = {
        sig: event.headers["x-signature-ed25519"],
        timestamp: event.headers["x-signature-timestamp"]
    };
    if (!event.body || !checksum.timestamp || !checksum.sig) {
        return respondWithError("Invalid signature");
    }
    let isVerified = false;

    try {
        isVerified = sign.detached.verify(
            Buffer.from(checksum.timestamp + event.body),
            Buffer.from(checksum.sig, "hex"),
            publicKeyBuffer
        );
    } catch (e) {
        console.log(e);
        isVerified = false
    }
    if (!isVerified) {
        return respondWithError("Invalid signature");
    }
    return;
}

export const respondWithMessage = function (content?: string): APIGatewayProxyResultV2 {
    if (!content) return { statusCode: 200, body: JSON.stringify({ type: InteractionResponseType.ChannelMessageWithSource }) };

    const body: APIInteractionResponseChannelMessageWithSource = {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
            content
        }
    }
    return {
        statusCode: 200,
        body: JSON.stringify(body)
    }
}
export const respondWithError = function (errorMessage: string, statusCode: number = 400): APIGatewayProxyResultV2 {
    return {
        statusCode,
        body: JSON.stringify({ errorMessage })
    };
}
