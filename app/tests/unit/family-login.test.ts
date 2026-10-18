// Ошибки семейного входа: 503 «не настроен» — понятный текст без повторов wake; повторяются только сеть и 502/504.
import { describe, expect, it } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { FamilyLoginError, NOT_CONFIGURED, familyLogin } from '../../src/lib/family-login';
import { setClient } from '../../src/lib/supabase';
import { isRetryable } from '../../src/ui/wake';

function answer(error: unknown) {
  setClient({ functions: { invoke: async () => ({ data: null, error }) } } as unknown as SupabaseClient);
}
const http = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const caught = async () => familyLogin('Пётр Иванов', 'x').then(() => null, (e: unknown) => e);

describe('семейный вход: ошибки', () => {
  it('503 «не настроен» — текст для человека и без повторов', async () => {
    answer(http(503, { error: 'Вход по семейному паролю не настроен' }));
    const e = await caught();
    expect(e).toBeInstanceOf(FamilyLoginError);
    expect((e as Error).message).toBe(NOT_CONFIGURED);
    expect(isRetryable(e)).toBe(false);
  });
  it('502 и 504 шлюза — повторяются', async () => {
    for (const status of [502, 504]) {
      answer(http(status, {}));
      expect(isRetryable(await caught())).toBe(true);
    }
  });
  it('сеть — повторяется', async () => {
    answer(new FunctionsFetchError(new TypeError('Failed to fetch')));
    expect(isRetryable(await caught())).toBe(true);
  });
  it('409 «Это вы?» — кандидаты в ошибке, без повторов', async () => {
    const candidates = [{ id: 'a', fio: 'Иванов Пётр', birth_year: 1955 }];
    answer(http(409, { error: 'Это вы?', need: 'confirm', candidates }));
    const e = (await caught()) as FamilyLoginError;
    expect(e.need).toBe('confirm');
    expect(e.candidates).toEqual(candidates);
    expect(isRetryable(e)).toBe(false);
  });
});
