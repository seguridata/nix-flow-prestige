/**
 * M13 — plantillas de correo. HTML sobrio en la línea de marca de SeguriData
 * (negro carbón #191919, acento verde #84BD00, gris #5B6770). Sin dependencias
 * de maquetado: `table`-based para compatibilidad con clientes de correo.
 */

const BRAND = {
  carbon: '#191919',
  green: '#84BD00',
  gray: '#5B6770',
  paper: '#F3F3F3',
};

function shell(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<tr><td style="padding:8px 0 4px">
         <a href="${cta.url}" style="display:inline-block;background:${BRAND.carbon};color:#fff;
            text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;font-size:14px">
           ${cta.label}
         </a></td></tr>
       <tr><td style="font-size:12px;color:${BRAND.gray};padding-top:8px;word-break:break-all">
         ${cta.url}
       </td></tr>`
    : '';
  return `<!doctype html><html lang="es"><body style="margin:0;background:${BRAND.paper};
    font-family:Segoe UI,Helvetica,Arial,sans-serif;color:${BRAND.carbon}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="background:#fff;border:1px solid #e3e3e3;border-radius:10px;overflow:hidden">
        <tr><td style="background:${BRAND.carbon};padding:18px 28px">
          <span style="color:#fff;font-size:16px;font-weight:700;letter-spacing:.5px">PRESTIGE</span>
          <span style="color:${BRAND.green};font-size:16px;font-weight:700"> ·</span>
          <span style="color:#c9c9c9;font-size:12px"> SeguriData</span>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 12px;font-size:19px">${title}</h1>
          <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;color:#2b2b2b">
            ${bodyHtml}
            ${button}
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;font-size:11px;color:${BRAND.gray}">
          Este mensaje se envió automáticamente por el flujo de firma de Prestige. La validez del
          expediente se comprueba con el verificador offline incluido en el dossier de evidencia.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

export interface Rendered {
  subject: string;
  html: string;
}

export const templates = {
  signInvite(p: { signerName?: string; requesterName?: string; documentTitle: string; url: string }): Rendered {
    return {
      subject: `Tienes un documento por firmar: ${p.documentTitle}`,
      html: shell(
        'Documento por firmar',
        `<tr><td>Hola${p.signerName ? ` ${p.signerName}` : ''},</td></tr>
         <tr><td style="padding-top:8px">${p.requesterName ?? 'Prestige'} te envió
           <strong>${p.documentTitle}</strong> para tu firma electrónica.</td></tr>
         <tr><td style="padding-top:8px">Abre el enlace personal de un solo uso para revisar el
           documento, aceptar el consentimiento y firmar.</td></tr>`,
        { label: 'Revisar y firmar', url: p.url },
      ),
    };
  },

  reminder(p: { signerName?: string; documentTitle: string; url: string }): Rendered {
    return {
      subject: `Recordatorio de firma: ${p.documentTitle}`,
      html: shell(
        'Recordatorio de firma',
        `<tr><td>Hola${p.signerName ? ` ${p.signerName}` : ''},</td></tr>
         <tr><td style="padding-top:8px">Sigue pendiente tu firma de
           <strong>${p.documentTitle}</strong>. Puedes completarla desde tu enlace personal.</td></tr>`,
        { label: 'Firmar ahora', url: p.url },
      ),
    };
  },

  escalation(p: { requesterName?: string; signerLabel: string; documentTitle: string; url: string }): Rendered {
    return {
      subject: `Escalamiento: la firma de ${p.signerLabel} venció su SLA (${p.documentTitle})`,
      html: shell(
        'Escalamiento de firma',
        `<tr><td>Hola${p.requesterName ? ` ${p.requesterName}` : ''},</td></tr>
         <tr><td style="padding-top:8px">La firma de <strong>${p.signerLabel}</strong> en
           <strong>${p.documentTitle}</strong> superó su plazo (SLA). La tarea quedó marcada como
           escalada y con prioridad alta en la bandeja.</td></tr>`,
        { label: 'Ver la solicitud', url: p.url },
      ),
    };
  },

  completed(p: { name?: string; documentTitle: string; url: string }): Rendered {
    return {
      subject: `Documento firmado: ${p.documentTitle}`,
      html: shell(
        'Documento firmado',
        `<tr><td>Hola${p.name ? ` ${p.name}` : ''},</td></tr>
         <tr><td style="padding-top:8px"><strong>${p.documentTitle}</strong> quedó firmado por todas
           las partes. Ya puedes descargar el expediente de evidencia (manifiesto firmado + sello de
           tiempo RFC 3161 + verificador offline).</td></tr>`,
        { label: 'Descargar evidencia', url: p.url },
      ),
    };
  },
};
