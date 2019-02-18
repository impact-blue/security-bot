import { APIGatewayEvent, Callback, Context, Handler, ScheduledEvent, SNSEvent } from 'aws-lambda';
import { DynamoDB, SNS } from 'aws-sdk';
import { createHmac } from 'crypto';
import nodeFetch from 'node-fetch';
import { request } from 'https';

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
    callback(new Error('CHATWORK_WEBHOOK_TOKEN is not set!'));
  }

  if (!requestSignature) {
    callback(new Error('Chatwork webhook signature header missing!'));
  }

  if (!requestBody) {
    callback(new Error('Request body is empty!'));
  }

  if (requestSignature !== expectedSignature) {
    callback(new Error("The request signature doesn't match the expected signature!"));
  }

  if (messageBody.startsWith('ブルーくん')) {
    const addWord: number = messageBody.indexOf('を追加して');
    const removeWord: number = messageBody.indexOf('を削除して');

    let message: string = '';
    let topicName: string = '';

    if (messageBody.indexOf('使い方教えて') > -1) {
      message = 'help';
      topicName = 'help';
    } else if (addWord > -1) {
      message = messageBody.substring('ブルーくん、'.length, addWord);
      topicName = 'addWord';
    } else if (removeWord > -1) {
      message = messageBody.substring('ブルーくん、'.length, removeWord);
      topicName = 'removeWord';
    } else if (messageBody.indexOf('対象言葉みせて') > -1) {
      message = 'getWords';
      topicName = 'getWords';
    }

    if (message.length > 0 && topicName.length > 0) {
      sns.createTopic({ Name: topicName }).promise().then((data: SNS.CreateTopicResponse) => {
        sns.publish({ TopicArn: data.TopicArn, Message: message }).promise().catch((error: AWS.AWSError) => callback(error));
      }).catch((error: AWS.AWSError) => callback(error));
    }
  }
};

export const sendMessage: Handler = (event: SNSEvent, context: Context, callback: Callback) => {
  const chatroomId: string = process.env.CHATWORK_CHATROOM_ID;
  const token: string = process.env.CHATWORK_API_TOKEN;
  const message: string = `[info][title]ブルーくん[/title]${event.Records[0].Sns.Message}[/info]`;

  nodeFetch(`https://api.chatwork.com/v2/rooms/${chatroomId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-ChatWorkToken': token,
    },
    body: `body=${message}`,
  } as ChatworkRequest).catch((error: Error) => callback(error));
};

export const addWord: Handler = (event: SNSEvent, context: Context, callback: Callback) => {
  const word: string = event.Records[0].Sns.Message;
  const params: DynamoDB.DocumentClient.PutItemInput = {
    TableName: 'words',
    Item: {
      name: word,
    },
    ConditionExpression: 'attribute_not_exists(#n)',
    ExpressionAttributeNames: {
      '#n': 'name',
    },
  };

  dynamoDB.put(params).promise().then((data: DynamoDB.PutItemOutput) => {
    const message: string = `${word}を追加しました！`;
    const topicName: string = 'sendMessage';

    sns.createTopic({ Name: topicName }).promise().then((data: SNS.CreateTopicResponse) => {
      sns.publish({ TopicArn: data.TopicArn, Message:  message }).promise().catch((error: AWS.AWSError) => callback(error));
    }).catch((error: AWS.AWSError) => callback(error));
  }).catch((error: AWS.AWSError) => {
    if (error.code === 'ConditionalCheckFailedException') {
      const message: string = `${word}はすでに登録されています！`;
      const topicName: string = 'sendMessage';

      sns.createTopic({ Name: topicName }).promise().then((data: SNS.CreateTopicResponse) => {
        sns.publish({ TopicArn: data.TopicArn, Message:  message }).promise().catch((error: AWS.AWSError) => callback(error));
      }).catch((error: AWS.AWSError) => callback(error));
    } else {
      callback(error);
    }
  });
};

export const removeWord: Handler = async (event: SNSEvent, context: Context, callback: Callback) => {
  const word = event.Records[0].Sns.Message;
  const params: DynamoDB.DocumentClient.DeleteItemInput = {
    TableName: 'words',
    Key: {
      name: word,
    },
    ConditionExpression: 'attribute_exists(#n)',
    ExpressionAttributeNames: {
      '#n': 'name',
    },
  };

  try {
    await dynamoDB.delete(params).promise();

    const message = `${word}を削除しました！`;
    const topicName = 'sendMessage';
    const { TopicArn } = await sns.createTopic({ Name: topicName }).promise();

    await sns.publish({ TopicArn, Message:  message }).promise();
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      try {
        const message = `${word}は登録されていません！`;
        const topicName = 'sendMessage';
        const { TopicArn } = await sns.createTopic({ Name: topicName }).promise();

        await sns.publish({ TopicArn, Message:  message }).promise();
      } catch (error) {
        callback(error);
      }
    } else {
      callback(error);
    }
  }
};

export const getWords: Handler = async (event: SNSEvent, context: Context, callback: Callback) => {
  const words: string[] = [];
  const message = '対象言葉：\n';
  const topicName = 'sendMessage';
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: 'words',
  };

  try {
    const data = await dynamoDB.scan(params).promise();
    data.Items.forEach((word: Word) => words.push(word.name));

    const { TopicArn } = await sns.createTopic({ Name: topicName }).promise();
    await sns.publish({ TopicArn, Message: message + words.join('\n') }).promise();
  } catch (error) {
    callback(error);
  }
};

export const checkRSS: Handler = (event: ScheduledEvent, context: Context, callback: Callback) => {
  // check rss from now back to 10am yesterday
  // if monday, check back until friday 10am
};

export const help: Handler = async (event: SNSEvent, context: Context, callback: Callback) => {
  const message = '使い方：\nブルーくん、使い方教えて\nブルーくん、phpを追加して\nブルーくん、phpを削除して\nブルーくん、対象言葉みせて';
  const topicName = 'sendMessage';

  try {
    const { TopicArn } = await sns.createTopic({ Name: topicName }).promise();
    await sns.publish({ TopicArn, Message:  message }).promise();
  } catch (error) {
    callback(error);
  }
};
