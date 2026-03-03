export interface SendMessageParams {
  channel: string;
  message: string;
  thread_ts?: string;
}

export interface SendMessageResult {
  status: 'success' | 'error';
  message: string;
  channel: string;
  channel_id?: string;
  message_ts?: string;
  sent_message?: string;
  thread_ts?: string;
}
