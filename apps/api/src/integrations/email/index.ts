import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../../config/env.js';
import { childLogger } from '../../lib/logger.js';

const log = childLogger('email');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Email transport, behind an interface.
 *
 * Nothing in the booking domain knows how mail is sent — it writes an outbox row and a
 * worker hands it to whichever provider is configured. Swapping the console provider for
 * Resend, SES or SendGrid later is a new file here plus one line in `createEmailProvider`;
 * no booking code changes.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Prints the message. The default in development — zero setup, nothing leaves the machine. */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<void> {
    log.info(
      { to: message.to, subject: message.subject },
      `EMAIL → ${message.to}\n${message.subject}\n${'─'.repeat(50)}\n${message.text}\n`,
    );
  }
}

/**
 * Writes each message as a .eml file. Useful when you want to actually read what was sent,
 * including the management links, without wiring up a real mailbox.
 */
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
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text,
    ].join('\n');

    await writeFile(file, body, 'utf8');
    log.info({ to: message.to, file }, 'Email written to disk');
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  provider = env.EMAIL_PROVIDER === 'file' ? new FileEmailProvider() : new ConsoleEmailProvider();
  log.info({ provider: provider.name }, 'Email provider ready');
  return provider;
}

/** Test seam — lets a test assert on what would have been sent. */
export function setEmailProvider(next: EmailProvider | null): void {
  provider = next;
}
