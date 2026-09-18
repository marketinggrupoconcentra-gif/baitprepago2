/**
 * tests/unit/settings-validators.test.ts — Reglas de formato de /admin/settings
 */
import { describe, test, expect } from 'vitest';
import { SETTING_VALIDATORS, EDITABLE_SETTING_KEYS, SENSITIVE_KEYS } from '../../src/lib/settings';

const ok = (key: keyof typeof SETTING_VALIDATORS, v: string) => expect(SETTING_VALIDATORS[key]!(v)).toBeNull();
const bad = (key: keyof typeof SETTING_VALIDATORS, v: string) => expect(SETTING_VALIDATORS[key]!(v)).toEqual(expect.any(String));

describe('capturista de Intelix', () => {
  test('solo dígitos, cualquier longitud', () => {
    ok('intelix_capturista', '89991');
    ok('intelix_capturista', '1');
    ok('intelix_capturista', '000123456789012345');
    bad('intelix_capturista', '899-91');
    bad('intelix_capturista', 'A8999');
    bad('intelix_capturista', '89 991');
    bad('intelix_capturista', '');
  });
});

describe('otras reglas', () => {
  test('chat_id e ids de conversión numéricos', () => {
    ok('intelix_chat_id', '1'); bad('intelix_chat_id', '1a');
    ok('google_ads_conversion_action_id', '123456789'); bad('google_ads_conversion_action_id', 'AW-123');
  });
  test('URL de Intelix con https', () => {
    ok('intelix_api_url', 'https://intelix-api.grupoconcentra.com/api/botmaker/store/portability');
    bad('intelix_api_url', 'http://intelix-api.grupoconcentra.com/x');
  });
  test('valor de conversión en MXN', () => { ok('conversion_won_value', '100'); ok('conversion_won_value', '99.50'); bad('conversion_won_value', '1,000'); });
  test('presupuestos de marketing en MXN mensual', () => { ok('marketing_budget_google_ads', '135000'); ok('marketing_budget_meta_ads', '72000.50'); ok('marketing_budget_seo', '0'); bad('marketing_budget_google_ads', '135,000'); bad('marketing_budget_seo', 'abc'); });
  test('los secretos están dentro de las claves editables', () => {
    for (const k of SENSITIVE_KEYS) expect(EDITABLE_SETTING_KEYS as readonly string[]).toContain(k);
  });
});
