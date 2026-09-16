import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { childLogger } from '../../lib/logger.js';

const log = childLogger('email');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional rich body. Clients that cannot render it fall back to `text`. */
  html?: string;
}

/**
 * Email transport, behind an interface.
 *
 * Nothing in the booking domain knows how mail is sent — a booking writes an outbox row
 * inside its own transaction and a worker hands it to whichever provider is configured.
 * Adding Resend, SES or Postmark later is a new class here and one line in the factory;
 * no booking code changes.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Prints the message. Default in development — zero setup, nothing leaves the machine. */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<void> {
    log.info(
      { to: message.to, subject: message.subject },
      `EMAIL → ${message.to}\n${message.subject}\n${'─'.repeat(50)}\n${message.text}\n`,
    );
  }
}

/** Writes each message as a .eml file you can open in a mail client. */
class FileEmailProvider implements EmailProvider {
  readonly name = 'file';
  private readonly directory = resolve(process.cwd(), env.MAIL_OUTPUT_DIR);

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, '_');
    const file = join(this.directory, `${stamp}-${safeTo}.eml`);

    const body = [
      `From: ${env.EMAIL_FROM}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      message.html ?? message.text,
    ].join('\n');

    await writeFile(file, body, 'utf8');
    log.info({ to: message.to, file }, 'Email written to disk');
  }
}

/**
 * Real delivery through any SMTP server — Gmail, SES, Mailgun, a corporate relay.
 *
 * The transport is created once and reused: SMTP connection setup costs a TLS handshake
 * and several round trips, which is wasteful to repeat for every reminder in a batch.
 */
class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private transporter: Transporter | null = null;

  private transport(): Transporter {
    if (this.transporter) return this.transporter;
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } }
        : {}),
      pool: true,
      maxConnections: 3,
    });
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    const info = await this.transport().sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    log.info({ to: message.to, messageId: info.messageId }, 'Email sent via SMTP');
  }
}

/**
 * Delivers to a throwaway Ethereal inbox and logs a preview URL.
 *
 * Ethereal accepts the message, renders it, and never forwards it anywhere — so this
 * proves the whole path works, with a real SMTP handshake and a link you can open to see
 * exactly what the customer would receive, without needing anyone's credentials.
 */
class EtherealEmailProvider implements EmailProvider {
  readonly name = 'ethereal';
  private transporter: Transporter | null = null;
  private account: { user: string; pass: string } | null = null;

  private async transport(): Promise<Transporter> {
    if (this.transporter) return this.transporter;
    const account = await nodemailer.createTestAccount();
    this.account = { user: account.user, pass: account.pass };
    this.transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    });
    log.info(
      { inbox: 'https://ethereal.email/login', user: account.user, pass: account.pass },
      'Ethereal test inbox ready — sign in with these to read every message sent',
    );
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    const info = await (await this.transport()).sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    const preview = nodemailer.getTestMessageUrl(info);
    log.info({ to: message.to, preview, inbox: this.account?.user }, `Email preview: ${preview}`);
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;

  switch (env.EMAIL_PROVIDER) {
    case 'smtp':
      provider = new SmtpEmailProvider();
      break;
    case 'ethereal':
      provider = new EtherealEmailProvider();
      break;
    case 'file':
      provider = new FileEmailProvider();
      break;
    default:
      provider = new ConsoleEmailProvider();
  }

  log.info({ provider: provider.name }, 'Email provider ready');
  return provider;
}

/** Test seam — lets a test assert on what would have been sent. */
export function setEmailProvider(next: EmailProvider | null): void {
  provider = next;
}
