interface ChatworkRequest {
  method: 'POST';
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-ChatWorkToken': string,
  };
  body: string;
}

interface ChatworkWebhookResponse {
  webhook_setting_id: string;
  webhook_event_type: string;
  webhook_event_time: number;
  webhook_event: {
    from_account_id: number,
    to_account_id: number,
    room_id: number,
    message_id: number,
    body: string,
    send_time: number,
    update_time: number,
  };
}
