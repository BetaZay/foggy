export class FogError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'FogError';
    this.status = options.status;
    this.code = options.code || 'FOG_ERROR';
  }
}

export class FogNotConfiguredError extends FogError {
  constructor(setupRequired = false) {
    super('FOG connection is not configured', {
      code: setupRequired ? 'FOG_CREDENTIALS_REQUIRED' : 'FOG_NOT_CONFIGURED',
    });
    this.name = 'FogNotConfiguredError';
  }
}

export class FogValidationError extends FogError {
  constructor(message, fields) {
    super(message, { code: 'FOG_VALIDATION_ERROR' });
    this.name = 'FogValidationError';
    this.fields = fields;
  }
}

export class FogConflictError extends FogError {
  constructor(message) {
    super(message, { code: 'FOG_CONFLICT' });
    this.name = 'FogConflictError';
  }
}
