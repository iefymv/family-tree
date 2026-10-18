// Чистая логика scripts/seed-family.ts на вымышленных Ивановых (без базы).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { factRows, isLocalUrl, personRow, relationRef, relationRow, SeedError, validateFamily, type Family } from '../../scripts/seed-family.ts';

const fixture = (): Family => JSON.parse(readFileSync(new URL('../fixtures/family-ivanovy.json', import.meta.url), 'utf8'));

describe('seed-family: логика', () => {
  test('фикстура проходит проверку', () => validateFamily(fixture()));

  test('ошибки называют позицию и поле, но не значения', () => {
    const f = fixture();
    f.people.push({ ...f.people[0] });
    f.relations.push({ kind: 'parent', parent: 'seedtest-нет-такого', child: 'seedtest-ivanov-ilya' });
    f.facts.push({ person: 'seedtest-ivanov-ilya', kind: 'x', value: 'y', certainty: 'точно' as never });
    assert.throws(() => validateFamily(f), (e: Error) => {
      assert.ok(e instanceof SeedError);
      assert.match(e.message, /people\[6\]\.ref: повтор/);
      assert.match(e.message, /relations\[6\]\.parent: нет такого ref/);
      assert.match(e.message, /facts\[3\]\.certainty/);
      assert.doesNotMatch(e.message, /seedtest|Семён|Иванов|точно/);
      return true;
    });
  });

  test('ref связи детерминирован; супруги не зависят от порядка', () => {
    assert.equal(relationRef({ kind: 'spouse', a: 'b', b: 'a' }), relationRef({ kind: 'spouse', a: 'a', b: 'b' }));
    assert.equal(relationRef({ kind: 'spouse', a: 'b', b: 'a' }), 'rel:spouse:a:b');
    assert.equal(relationRef({ kind: 'parent', parent: 'p', child: 'c' }), 'rel:parent:p:c:biological');
    assert.equal(relationRef({ kind: 'parent', parent: 'p', child: 'c', parent_type: 'raised_by' }), 'rel:parent:p:c:raised_by');
  });

  test('супруги упорядочены по uuid, spouse_order 1', () => {
    const ids = new Map([['x', 'ffffffff-0000-4000-8000-000000000000'], ['y', '00000000-0000-4000-8000-000000000001']]);
    const r = relationRow({ kind: 'spouse', a: 'x', b: 'y' }, ids);
    assert.equal(r.from_person, ids.get('y'));
    assert.equal(r.to_person, ids.get('x'));
    assert.equal(r.spouse_order, 1);
    assert.equal(r.parent_type, null);
  });

  test('даты: текст как есть, диапазон из dates.ts, непонятное — null', () => {
    const [semen, anna, nikolai] = fixture().people;
    const s = personRow(semen);
    assert.deepEqual([s.birth_date_text, s.birth_date_from, s.birth_date_to], ['20–25.05.1898', '1898-05-20', '1898-05-25']);
    const a = personRow(anna);
    assert.deepEqual([a.birth_date_from, a.birth_date_to], ['1900-01-01', '1904-12-31']);
    assert.deepEqual([a.death_date_text, a.death_date_from, a.death_date_to], ['осенью, точно неизвестно', null, null]);
    assert.equal(personRow(nikolai).birth_date_from, '1898-01-01');
    assert.equal(a.needs_check, false);
    assert.deepEqual(a.name_variants, []);
  });

  test('факты: номер по человеку, источник по умолчанию', () => {
    const f = fixture();
    const ids = new Map(f.people.map((p, i) => [p.ref, `id-${i}`]));
    const rows = factRows(f, ids);
    assert.deepEqual(rows.map((r) => r.external_ref), ['fact:seedtest-ivanov-semen:1', 'fact:seedtest-ivanov-semen:2', 'fact:seedtest-ivanova-anna:1']);
    assert.equal(rows[0].source, f.source_default);
    assert.equal(rows[1].source, 'Вымышленная метрика');
  });

  test('только локальный адрес без --prod', () => {
    for (const u of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'http://api.localhost']) assert.ok(isLocalUrl(u), u);
    for (const u of ['https://abc.supabase.co', 'http://127.0.0.1.evil.com', 'не url']) assert.ok(!isLocalUrl(u), u);
  });
});
