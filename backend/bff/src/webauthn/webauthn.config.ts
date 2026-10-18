import { Injectable } from '@nestjs/common';

/**
 * `rpID` es el hostname (sin protocolo ni puerto) donde vive el navegador que
 * hace la ceremonia — no el del BFF. Por default se deriva de
 * `PUBLIC_WEB_URL` (ya existe, lo usa `OneTimeLinkService`) para no duplicar
 * configuración; solo hace falta fijar `WEBAUTHN_RP_ID` cuando el dominio
 * público de producción no sea igual al de `PUBLIC_WEB_URL`.
 */
@Injectable()
export class WebauthnConfig {
  readonly origin: string;
  readonly rpID: string;
  readonly rpName: string;

  constructor() {
    this.origin = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3001').replace(/\/$/, '');
    this.rpID = process.env.WEBAUTHN_RP_ID?.trim() || new URL(this.origin).hostname;
    this.rpName = process.env.WEBAUTHN_RP_NAME?.trim() || 'Prestige';
  }
}
