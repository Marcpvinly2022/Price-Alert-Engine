import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    firstName: z
      .string({ required_error: "First name is required." })
      .trim()
      .min(2)
      .max(20),

    lastName: z
      .string({ required_error: "Last name is required." })
      .trim()
      .min(2)
      .max(50),

    displayName: z.string().trim().min(2).max(50),

    phone: z
      .string({ required_error: "Phone number is required." })
      .trim()
      .regex(/^\+?[1-9]\d{7,14}$/, {
        message: "Phone number must be in international format.",
      }),

    email: z.string({ required_error: "Email is required." }).email(),

    password: z
      .string({ required_error: "Password is required." })
      .min(8, "Password must be at least 8 characters long.")
      .regex(/[A-Z]/, "Password must contain an uppercase letter.")
      .regex(/[a-z]/, "Password must contain a lowercase letter.")
      .regex(/[0-9]/, "Password must contain a number.")
      .regex(/[^A-Za-z0-9]/, "Password must contain a special character."),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const validate = (schema) => {
  return (req, res, next) => {
    try {
      const parsed = schema.parse({ body: req.body });

      req.validatedBody = parsed.body;

      return next();
    } catch (err) {
      return res.status(400).json({
        status: "FAIL",
        error: "VALIDATION_ERROR",
        details: err.issues,
      });
    }
  };
};
