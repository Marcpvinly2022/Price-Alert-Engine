import { z } from 'zod';

const createAlertSchema = z.object({
  currencyPair: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}_[A-Z]{3}$/, {
      message: 'Currency pair must follow BASE_TARGET format, e.g. USD_NGN',
    }),

  targetRate: z
    .number({
      required_error: 'Target rate is required',
      invalid_type_error: 'Target rate must be a number',
    })
    .positive('Target rate must be greater than zero'),

  condition: z.enum(['ABOVE', 'BELOW'], {
    errorMap: () => ({
      message: 'Condition must be either ABOVE or BELOW',
    }),
  }),
});

export const validateCreateAlert = (req, res, next) => {
  try {
    req.validatedBody = createAlertSchema.parse(req.body);
    next();
  } catch (err) {
    return res.status(400).json({
      status: 'FAIL',
      error: 'VALIDATION_ERROR',
      details: err.issues.map((issue) => issue.message),
    });
  }
};