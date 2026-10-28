import { I18nService } from '../i18n/i18n.service';
import { AiStreamEvent } from '../../shared/models/ai';

/** El motivo técnico sigue disponible, pero los casos conocidos se explican en el idioma de la pantalla. */
export function aiFailureMessage(
  error: Extract<AiStreamEvent, { kind: 'error' }>,
  i18n: I18nService,
): string {
  switch (error.code) {
    case 'unsupportedModel':
      return i18n.t('ai.failure.unsupportedModel');
    case 'authentication':
      return i18n.t('ai.failure.authentication');
    case 'quota':
      return i18n.t('ai.failure.quota');
    case 'network':
      return i18n.t('ai.failure.network');
    default:
      return error.message;
  }
}
