import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

/**
 * Sends account emails. No mail server in v1: outside production the email is
 * printed to the console so the flow can be tried locally (PRD A9).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly printEmails: boolean;

  constructor(config: ConfigService<AppConfig, true>) {
    this.printEmails = config.get('app.env', { infer: true }) !== 'production';
  }

  sendVerificationEmail(to: string, token: string, expiresAt: Date): void {
    if (!this.printEmails) {
      // a real mail provider would go here; never log the token in production
      this.logger.warn(
        `No mail server configured; verification email to ${to} not sent`,
      );
      return;
    }
    this.logger.log(
      [
        `To: ${to}`,
        'Subject: Verify your EchoGPT email',
        `Token (valid until ${expiresAt.toISOString()}): ${token}`,
        `Verify with: POST /api/v1/auth/verify-email {"token":"${token}"}`,
      ].join(' | '),
    );
  }
}
