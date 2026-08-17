import express from "express";
import { validate, registerSchema, loginSchema} from "../validators/auth.validator.js";

import { handleRegister, handleLogin } from "../controllers/auth.controller.js";

const router = express.Router();

router.post('/auth/register', validate(registerSchema), handleRegister);
router.post('/auth/login', validate(loginSchema), handleLogin);

export default router;