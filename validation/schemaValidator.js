const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({
  allErrors: true,
  removeAdditional: false,
  coerceTypes: true,
  strict: false,
});
addFormats(ajv);

function formatErrors(errors = []) {
  return errors
    .map((error) => {
      const path = error.instancePath || error.schemaPath || 'payload';
      return `${path} ${error.message || 'is invalid'}`.trim();
    })
    .slice(0, 10);
}

function validateBody(schema) {
  const validate = ajv.compile(schema);
  return (req, res, next) => {
    const valid = validate(req.body || {});
    if (valid) {
      return next();
    }
    return res.status(400).json({
      success: false,
      message: 'Invalid request payload.',
      errors: formatErrors(validate.errors),
    });
  };
}

module.exports = {
  validateBody,
};
