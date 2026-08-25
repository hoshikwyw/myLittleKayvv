/**
 * Notification channels.
 *
 * Same adapter shape as the LLM and voice layers. A channel either delivers or
 * says why it did not — it never throws, because one dead channel must not stop
 * the next one from being tried.
 */

export type ChannelName = "telegram" | "email" | "in_app";

export interface DeliveryResult {
  channel: ChannelName;
  ok: boolean;
  error?: string;
}

export interface NotificationChannel {
  readonly name: ChannelName;
  /** False when credentials are missing; the dispatcher skips it silently. */
  isConfigured(): boolean;
  send(subject: string, body: string): Promise<DeliveryResult>;
}
