import type { ErrorObject } from 'ajv';
import type { DocumentSettings, SdocEnvelope, SdocMeta, TiptapNode } from '../../types';

interface DocumentValidator<T> {
  (value: unknown): value is T;
  errors?: ErrorObject[] | null;
}

export const validateEnvelope: DocumentValidator<SdocEnvelope>;
export const validateMetadataSchema: DocumentValidator<SdocMeta>;
export const validateDoc: DocumentValidator<TiptapNode>;
export const validateSettingsSchema: DocumentValidator<Partial<DocumentSettings>>;
