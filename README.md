# セキュリティー情報ボット・ブルーくん
チャットワーク x Serverless frameworkでAWS API Gateway, Lambda (TypeScript使用！), SNS, DynamoDB

### デプロイ方法
1. Serverless CLIをインストール
`npm install -g serverless`
or
`yarn global add serverless`

2. パッケージをインストール
`npm install`
or
`yarn`

3. AWSアカウントを登録
`serverless config credentials --provider aws --key 鍵 --secret シークレット`

4. デプロイ！
`serverless deploy`

### 使い方
* ブルーくん、phpを追加して
* ブルーくん、phpを削除して
* ブルーくん、対象言葉みせて

### AWSから削除
`serverless remove`
