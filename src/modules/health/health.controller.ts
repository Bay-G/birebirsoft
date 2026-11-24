import { Elysia, t } from 'elysia';
import { ServiceUnavailableError } from '../../core/errors.ts';

/** Public (API key gerektirmez). Orkestratör probe'ları için. */
export const healthController = (isReady: () => boolean) =>
  new Elysia({ name: 'health', prefix: '/health', tags: ['Health'] })
    .get('/', () => ({ status: 'ok' as const }), {
      response: { 200: t.Object({ status: t.Literal('ok') }) },
      detail: { summary: 'health', description: 'Süreç ayakta mı? API key gerekmez.', security: [] },
    })
    .get(
      '/ready',
      () => {
        if (!isReady()) throw new ServiceUnavailableError('Veri henüz belleğe yüklenmedi');
        return { status: 'ready' as const };
      },
      {
        response: { 200: t.Object({ status: t.Literal('ready') }) },
        detail: { summary: 'health/ready', description: 'Veri belleğe yüklendi mi? API key gerekmez.', security: [] },
      },
    );
