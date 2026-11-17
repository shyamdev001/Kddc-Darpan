import { Global, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

/** SMTP settings from the environment. Port 465 means TLS from the start; others upgrade with STARTTLS. */
export function smtpOptions(env: Record<string, string | undefined> = process.env) {
  const port = Number(env.SMTP_PORT || 587);
  const secure = env.SMTP_SECURE ? /^(1|true|yes)$/i.test(env.SMTP_SECURE) : port === 465;
  return {
    host: env.SMTP_HOST,
    port,
    secure,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
    // A slow or silent mail server must not hold up the offline check for long.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  };
}

/**
 * Outgoing email.
 * - MAIL_DRIVER=console (default, development): each message is written to the server log.
 * - MAIL_DRIVER=smtp: sent through SMTP_HOST (the bank's mail server, or a provider).
 * `send` throws when the mail server refuses, so callers can retry or tell the user.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  readonly driver: 'console' | 'smtp';
  private readonly transport: Transporter | null = null;

  constructor() {
    const wanted = (process.env.MAIL_DRIVER ?? 'console').toLowerCase();
    if (wanted === 'smtp' && process.env.SMTP_HOST) {
      this.driver = 'smtp';
      this.transport = createTransport(smtpOptions());
    } else {
      this.driver = 'console';
      if (wanted === 'smtp') this.logger.warn('MAIL_DRIVER=smtp but SMTP_HOST is not set; emails are written to this log instead.');
      else if (wanted !== 'console') this.logger.warn(`Unknown MAIL_DRIVER "${wanted}"; emails are written to this log instead.`);
    }
  }

  async send(msg: MailMessage): Promise<void> {
    if (!msg.to.length) return;
    const from = process.env.MAIL_FROM ?? 'KDCC Darpan <no-reply@localhost>';
    if (this.transport) {
      await this.transport.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text });
      this.logger.log(`Email "${msg.subject}" sent to ${msg.to.length} address${msg.to.length === 1 ? '' : 'es'}.`);
      return;
    }
    this.logger.log(
      ['', '----- email (not sent: console driver) -----', `From: ${from}`, `To: ${msg.to.join(', ')}`, `Subject: ${msg.subject}`, '', msg.text, '-----'].join('\n'),
    );
  }

  onModuleDestroy() {
    this.transport?.close();
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
