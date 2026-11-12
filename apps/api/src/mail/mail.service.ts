import { Global, Injectable, Logger, Module } from '@nestjs/common';

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

/**
 * Outgoing email. MAIL_DRIVER=console (default, development) writes each message to the server log
 * instead of sending it. Real sending (SMTP) is added with the production deploy.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  readonly driver: 'console' | 'smtp' = 'console';

  constructor() {
    const wanted = (process.env.MAIL_DRIVER ?? 'console').toLowerCase();
    if (wanted !== 'console') {
      this.logger.warn(`MAIL_DRIVER=${wanted} is not available yet; emails are written to this log instead.`);
    }
  }

  async send(msg: MailMessage): Promise<void> {
    if (!msg.to.length) return;
    const from = process.env.MAIL_FROM ?? 'KDCC Darpan <no-reply@localhost>';
    this.logger.log(
      ['', '----- email (not sent: console driver) -----', `From: ${from}`, `To: ${msg.to.join(', ')}`, `Subject: ${msg.subject}`, '', msg.text, '-----'].join('\n'),
    );
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
