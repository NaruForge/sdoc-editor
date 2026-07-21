import type { ErrorObject } from 'ajv';
import type { DocumentSettings, SdocEnvelope, TiptapNode } from '../../types';

interface DocumentValidator<T> {
  (value: unknown): value is T;
  errors?: ErrorObject[] | null;
}

export const validateEnvelope: DocumentValidator<SdocEnvelope>;
export const validateDoc: DocumentValidator<TiptapNode>;
export const validateSettingsSchema: DocumentValidator<Partial<DocumentSettings>>;
