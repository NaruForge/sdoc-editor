import { describe, expect, it } from 'vitest';
import {
  EN_EDITOR_MESSAGES,
  KO_EDITOR_MESSAGES,
  createEditorTranslator,
  formatEditorDate,
  isUiLanguagePreference,
  readUiLanguagePreference,
  resolveEditorLocale,
  resolveUiLanguagePreference,
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

  it('resolves an explicit UI language independently of the detected host language', () => {
    expect(resolveUiLanguagePreference('auto', 'ko-KR')).toBe('ko');
    expect(resolveUiLanguagePreference('auto', 'ja-JP')).toBe('en');
    expect(resolveUiLanguagePreference('en', 'ko-KR')).toBe('en');
    expect(resolveUiLanguagePreference('ko', 'en-US')).toBe('ko');
    expect(isUiLanguagePreference('auto')).toBe(true);
    expect(isUiLanguagePreference('system')).toBe(false);
    expect(readUiLanguagePreference('invalid')).toBe('auto');
  });

  it('keeps Korean and English catalogs structurally complete', () => {
    expect(Object.keys(KO_EDITOR_MESSAGES).sort())
      .toEqual(Object.keys(EN_EDITOR_MESSAGES).sort());
  });

  it('translates with deterministic interpolation behavior', () => {
    const translate = createEditorTranslator('ko');
    expect(translate('toolbar.bold')).toBe('굵게 (Ctrl+B)');
    expect(translate('common.apply')).toBe('적용');
    expect(translate('toolbar.diagram')).toBe('텍스트 다이어그램');
    expect(createEditorTranslator('en')('toolbar.diagram')).toBe('Text Diagram');
    expect(translate('toolbar.headingOption', { level: 3 })).toBe('제목 3');
    expect(translate('toolbar.headingOption')).toBe('제목 {{level}}');
    expect(translate('context.tableActions')).toBe('표 작업');
    expect(translate('files.unavailableReason', { reason: 'PDF' })).toBe('사용 불가: PDF');
    expect(translate('invalidDocument.title')).toBe('잘못된 문서 원본');
    expect(translate('invalidDocument.recoverLocalDraft')).toBe('로컬 초안에서 복구');
    expect(createEditorTranslator('en')('invalidDocument.recoveryFailed'))
      .toBe('The invalid source could not be recovered.');
    expect(translate('book.openChapter', { label: 'Intro' })).toBe('Intro 열기');
    expect(createEditorTranslator('en')('book.openChapter', { label: 'Intro' }))
      .toBe('Open Intro');
    expect(createEditorTranslator('en')('book.bytes', { count: (4096).toLocaleString('en-US') }))
      .toBe('4,096 bytes');
  });

  it('formats valid dates for the selected locale and preserves invalid values', () => {
    const value = new Date('2026-07-28T03:04:00.000Z');
    expect(formatEditorDate(value, 'en')).toContain('2026');
    expect(formatEditorDate(value, 'ko')).toContain('2026');
    expect(formatEditorDate('', 'ko')).toBe('—');
    expect(formatEditorDate('not-a-date', 'en')).toBe('not-a-date');
  });
});
