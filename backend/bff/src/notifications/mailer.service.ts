import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * M13 — transporte SMTP real (nodemailer). En local apunta a Mailpit
 * (`SMTP_HOST=localhost SMTP_PORT=1025`); en producción a un relay con
 * SPF/DKIM/DMARC (ver backend/infra/README-correo.md).
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger(MailerService.name);
  private transporter: Transporter | null = null;

  private get from(): string {
    return process.env.MAIL_FROM ?? 'Prestige <no-reply@prestige.seguridata.mx>';
  }

  get enabled(): boolean {
    return Boolean(process.env.SMTP_HOST);
  }

  private transport(): Transporter {
    if (!this.transporter) {
      const host = process.env.SMTP_HOST;
      if (!host) throw new Error('SMTP_HOST no está configurado');
      const port = Number(process.env.SMTP_PORT ?? 1025);
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;
      this.transporter = createTransport({
        host,
        port,
        secure: process.env.SMTP_SECURE === 'true',
        auth: user && pass ? { user, pass } : undefined,
      });
    }
    return this.transporter;
  }

  async send(message: { to: string; subject: string; html: string; text?: string }) {
    const info = await this.transport().sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text ?? message.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
    this.log.log(`Correo enviado a ${message.to} (${info.messageId})`);
    return info.messageId;
  }
}
