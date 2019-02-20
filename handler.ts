import { APIGatewayEvent, Callback, Context, Handler, ScheduledEvent, SNSEvent } from 'aws-lambda';
import { DynamoDB, SNS } from 'aws-sdk';
import { createHmac } from 'crypto';
import nodeFetch from 'node-fetch';
import rssParser, { Items } from 'rss-parser';
import moment, { relativeTimeThreshold } from 'moment';

const dynamoDB: DynamoDB.DocumentClient = new DynamoDB.DocumentClient();
const sns: SNS = new SNS();

export const checkMessage: Handler = async (event: APIGatewayEvent, context: Context, callback: Callback) => {
  const token = process.env.CHATWORK_WEBHOOK_TOKEN;
  const requestSignature = event.headers['X-ChatWorkWebhookSignature'];
  const requestBody: ChatworkWebhookResponse = JSON.parse(event.body);
  const hmac = createHmac('sha256', new Buffer(token, 'base64'));
  const expectedSignature = hmac.update(JSON.stringify(requestBody)).digest('base64');
  const messageBody = requestBody.webhook_event.body;

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
    callback(new Error('The request signature does not match the expected signature!'));
  }

  if (messageBody.startsWith('ブルーくん')) {
    const addWord: number = messageBody.indexOf('を追加');
    const removeWord: number = messageBody.indexOf('を削除');

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
    } else if (messageBody.indexOf('対象言葉') > -1) {
      message = 'getWords';
      topicName = 'getWords';
    }

    if (message.length > 0 && topicName.length > 0) {
      try {
        const { TopicArn } = await sns.createTopic({ Name: topicName }).promise();
        await sns.publish({ TopicArn, Message: message }).promise();
      } catch (error) {
        callback(error);
      }
    }
  }
};

export const sendMessage: Handler = async (event: SNSEvent, context: Context, callback: Callback) => {
  const request: ChatworkRequest = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-ChatWorkToken': process.env.CHATWORK_API_TOKEN,
    },
    body: `body=[info][title]ブルーくん[/title]${event.Records[0].Sns.Message}[/info]`,
  };

  try {
    await nodeFetch(`https://api.chatwork.com/v2/rooms/${process.env.CHATWORK_CHATROOM_ID}/messages`, request);
  } catch (error) {
    callback(error);
  }
};

export const addWord: Handler = async (event: SNSEvent, context: Context, callback: Callback) => {
  const word = event.Records[0].Sns.Message;
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

  try {
    await dynamoDB.put(params).promise();

    const { TopicArn } = await sns.createTopic({ Name: 'sendMessage' }).promise();
    await sns.publish({ TopicArn, Message: `${word}を追加しました！` }).promise();
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      try {
        const { TopicArn } = await sns.createTopic({ Name: 'sendMessage' }).promise();
        await sns.publish({ TopicArn, Message: `${word}はすでに登録されています！` }).promise();
      } catch (error) {
        callback(error);
      }
    } else {
      callback(error);
    }
  }
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

    const { TopicArn } = await sns.createTopic({ Name: 'sendMessage' }).promise();
    await sns.publish({ TopicArn, Message: `${word}を削除しました！` }).promise();
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      try {
        const { TopicArn } = await sns.createTopic({ Name: 'sendMessage' }).promise();
        await sns.publish({ TopicArn, Message: `${word}は登録されていません！` }).promise();
      } catch (error) {
        callback(error);
      }
    } else {
      callback(error);
    }
  }
};

export const getWords: Handler = async (event: SNSEvent, context: Context, callback: Callback) => {
  const params: DynamoDB.DocumentClient.QueryInput = {
    TableName: 'words',
  };

  try {
    const data = await dynamoDB.scan(params).promise();
    const words: string[] = data.Items.map((word: Word) => word.name);
    const { TopicArn } = await sns.createTopic({ Name: 'sendMessage' }).promise();

    await sns.publish({ TopicArn, Message: `対象言葉：\n${words.join('\n')}` }).promise();
  } catch (error) {
    callback(error);
  }
};

export const checkRSS: Handler = async (event: ScheduledEvent, context: Context, callback: Callback) => {
  const items: Items[] = [];
  const parser = new rssParser();
  const now = moment.utc();
  const isMonday = now.format('dddd') === 'Monday';
  const lastCheck = moment.utc();
  const words: Word[] = [];
  const feeds = [
    'https://www.jpcert.or.jp/rss/jpcert.rdf',
    'https://jvndb.jvn.jp/en/rss/jvndb_new.rdf',
  ];

  try {
    const data = await dynamoDB.scan({ TableName: 'words' }).promise();
    data.Items.forEach(item => words.push(item as Word));
  } catch (error) {
    callback(error);
  }

  if (isMonday) {
    lastCheck.subtract(3, 'days');
  } else {
    lastCheck.subtract(1, 'days');
  }

  lastCheck.set({ hour: 10, minute: 0, second: 0 });

  try {
    // 全てのフィードのアイテムを集める
    for await (const feed of feeds) { // asyncなので、Array.reduceよりfor of
      const output = await parser.parseURL(feed);
      items.concat(output.items);
    }

    // lastCheckとnowの間のアイテムだけを残す
    items.filter((item) => {
      const isoDate = moment(item.isoDate);
      return isoDate.isAfter(lastCheck) && isoDate.isBefore(now);
    });

    // 対象言葉がタイトルに含まれているアイテムだけを残す
    items.filter(item => words.filter(word => item.title.indexOf(word.name) > -1).length > 0);

    // チャットワークのメッセージに必要な情報だけを残す
    items.map(item => ({ title: item.title, link: item.link }));

    // チャットワークへメッセージ
    const { TopicArn } = await sns.createTopic({ Name: 'sendMessage' }).promise();
    await sns.publish({ TopicArn, Message: `アイテム：\n${items.join('\n')}` }).promise();
  } catch (error) {
    callback(error);
  }
};

export const help: Handler = async (event: SNSEvent, context: Context, callback: Callback) => {
  const message = '使い方：\nブルーくん、使い方教えて\nブルーくん、phpを追加して\nブルーくん、phpを削除して\nブルーくん、対象言葉みせて';

  try {
    const { TopicArn } = await sns.createTopic({ Name: 'sendMessage' }).promise();
    await sns.publish({ TopicArn, Message:  message }).promise();
  } catch (error) {
    callback(error);
  }
};
