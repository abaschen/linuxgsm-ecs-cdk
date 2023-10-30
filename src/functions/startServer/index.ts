
import { APIGatewayEvent, APIGatewayProxyResultV2, Context } from 'aws-lambda';

import { APIBaseInteraction, APIChatInputApplicationCommandInteractionData, APIInteractionResponse, InteractionResponseType, InteractionType } from 'discord-api-types/v10';
import { respondWithError, respondWithMessage, verify } from '@layer/discord';

export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResultV2<APIInteractionResponse>> => {

    const error = await verify(event);
    if (error) {
        return error;
    }
    const { type, data }: APIBaseInteraction<InteractionType, APIChatInputApplicationCommandInteractionData> = JSON.parse(event.body ?? "{}");

    if ((type === InteractionType.ApplicationCommand || type === InteractionType.ApplicationCommandAutocomplete) && !data) {
        return {
            statusCode: 400,
            body: JSON.stringify({ errorMessage: 'Empty data' })
        };
    } else if (type === InteractionType.Ping) {
        return respondWithMessage();
    }

    if (type === InteractionType.ApplicationCommand) {

    }
    return respondWithError(`Unknown command ${type}`);

}