import { describe, expect, it } from 'vitest';
import {
  EN_EDITOR_MESSAGES,
  KO_EDITOR_MESSAGES,
  createEditorTranslator,
  formatEditorDate,
  resolveEditorLocale,
} from '../shared/editor/i18n';

describe('editor i18n', () => {
  it('resolves Korean variants and falls back unsupported locales to English', () => {
    expect(resolveEditorLocale('ko')).toBe('ko');
    expect(resolveEditorLocale('ko-KR')).toBe('ko');
    expect(resolveEditorLocale('KO_kr')).toBe('ko');
    expect(resolveEditorLocale('en-GB')).toBe('en');
    expect(resolveEditorLocale('ja-JP')).toBe('en');
    expect(resolveEditorLocale(undefined)).toBe('en');
  });

  it('keeps Korean and English catalogs structurally complete', () => {
    expect(Object.keys(KO_EDITOR_MESSAGES).sort())
      .toEqual(Object.keys(EN_EDITOR_MESSAGES).sort());
  });

  it('translates with deterministic interpolation behavior', () => {
    const translate = createEditorTranslator('ko');
    expect(translate('toolbar.bold')).toBe('굵게 (Ctrl+B)');
    expect(translate('common.apply')).toBe('적용');
    expect(translate('toolbar.headingOption', { level: 3 })).toBe('제목 3');
    expect(translate('toolbar.headingOption')).toBe('제목 {{level}}');
  });

  it('formats valid dates for the selected locale and preserves invalid values', () => {
    const value = new Date('2026-07-28T03:04:00.000Z');
    expect(formatEditorDate(value, 'en')).toContain('2026');
    expect(formatEditorDate(value, 'ko')).toContain('2026');
    expect(formatEditorDate('', 'ko')).toBe('—');
    expect(formatEditorDate('not-a-date', 'en')).toBe('not-a-date');
  });
});
