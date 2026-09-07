import type { ErrorObject } from 'ajv';
import * as detailed from './generated/documentValidators.js';
import * as fast from './generated/fastDocumentValidators.js';

interface DocumentValidator<T> {
  (value: unknown): value is T;
  errors?: ErrorObject[] | null;
}

/** Keep detailed diagnostics on failure without collecting them for valid input. */
function withDetailedErrors<T>(
  accept: DocumentValidator<T>,
  diagnose: DocumentValidator<T>,
): DocumentValidator<T> {
  const validate: DocumentValidator<T> = (value: unknown): value is T => {
    if (accept(value)) {
      validate.errors = null;
      // Release the previous detailed failure even when this pass skips it.
      diagnose.errors = null;
      return true;
    }
    const valid = diagnose(value);
    validate.errors = diagnose.errors;
    return valid;
  };
  return validate;
}

export const validateEnvelope = withDetailedErrors(fast.validateEnvelope, detailed.validateEnvelope);
export const validateDoc = withDetailedErrors(fast.validateDoc, detailed.validateDoc);
export const validateMetadataSchema = withDetailedErrors(fast.validateMetadataSchema, detailed.validateMetadataSchema);
export const validateSettingsSchema = withDetailedErrors(fast.validateSettingsSchema, detailed.validateSettingsSchema);
