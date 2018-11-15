import { APIGatewayEvent, Callback, Context, Handler, SNSEvent } from 'aws-lambda';
import { DynamoDB, SNS } from 'aws-sdk';
import { createHmac } from 'crypto';
import fetch from 'node-fetch';
import { request } from 'https';
import seeds from './seeds.json';

const dynamoDB: DynamoDB.DocumentClient = new DynamoDB.DocumentClient();
const sns: SNS = new SNS();

export const checkMessage: Handler = (event: APIGatewayEvent, context: Context, callback: Callback) => {
  const token: string = process.env.CHATWORK_WEBHOOK_TOKEN;
  const requestSignature: string = event.headers['X-ChatWorkWebhookSignature'];
  const requestBody: ChatworkWebhookResponse = JSON.parse(event.body);
  const hmac = createHmac('sha256', new Buffer(token, 'base64'));
  const expectedSignature: string = hmac.update(JSON.stringify(requestBody)).digest('base64');
  const messageBody: string = requestBody.webhook_event.body;

  if (!token) {
    callback(new Error("CHATWORK_WEBHOOK_TOKEN is not set!"));
  }

  if (!requestSignature) {
    callback(new Error("Chatwork webhook signature header missing!"));
  }

  if (!requestBody) {
    callback(new Error("Request body is empty!"));
  }

  if (requestSignature !== expectedSignature) {
    callback(new Error("The request signature doesn't match the expected signature!"));
  }

  if (messageBody.startsWith('ブルーくん')) {
    const addWord: number = messageBody.indexOf('を追加して');
    const removeWord: number = messageBody.indexOf('を削除して');

    if (messageBody.indexOf('使い方教えて')) {
      sns.createTopic({ Name: 'help' }).promise().then((data: SNS.CreateTopicResponse) => {
        sns.publish({ TopicArn: data.TopicArn, Message: 'help' }).promise().catch((error: AWS.AWSError) => callback(error));
      }).catch((error: AWS.AWSError) => callback(error));
    } else if (addWord > -1) {
      const word: string = messageBody.substring('ブルーくん'.length, addWord);
      // send addWord sns (php)
    } else if (removeWord) {
      const word: string = messageBody.substring('ブルーくん'.length, addWord);
      // send removeWord sns (php)
    } else if (messageBody.indexOf('対象言葉みせて')) {
      // send getWords sns
    }
  }
};

export const sendMessage: Handler = (event: SNSEvent, context: Context, callback: Callback) => {
  const chatroomId: string = process.env.CHATWORK_CHATROOM_ID;
  const token: string = process.env.CHATWORK_API_TOKEN;
  const message: string = `[info][title]ブルーくん[/title]${event.Records[0].Sns.Message}[/info]`;

  fetch(`https://api.chatwork.com/v2/rooms/${chatroomId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-ChatWorkToken': token,
    },
    body: `body=${message}`,
  } as ChatworkRequest).catch((error: Error) => callback(error));
};

export const seed: Handler = (event: APIGatewayEvent, context: Context, callback: Callback) => {
  const params: DynamoDB.DocumentClient.PutItemInput = {
    TableName: 'words',
    Item: {
      name: '',
    }
  };

  seeds.words.forEach(({ name }: Word) => {
    params.Item.name = name;
    dynamoDB.put(params).promise().catch((error: AWS.AWSError) => callback(error));
  });
};

export const addWord: Handler = (event: APIGatewayEvent, context: Context) => {
};

export const removeWord: Handler = (event: APIGatewayEvent, context: Context) => {
};

export const getWords: Handler = (event: APIGatewayEvent, context: Context) => {
};


export const help: Handler = (event: SNSEvent, context: Context, callback: Callback) => {
  sns.createTopic({ Name: 'sendMessage' }).promise().then((data: SNS.CreateTopicResponse) => {
    sns.publish({ TopicArn: data.TopicArn, Message:  "使い方\nこうです" }).promise().catch((error: AWS.AWSError) => callback(error));
  }).catch((error: AWS.AWSError) => callback(error));
};
