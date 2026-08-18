import express from "express";
import { validate, registerSchema, loginSchema} from "../validators/auth.validator.js";

import { handleRegister, handleLogin, handleLogout } from "../controllers/auth.controller.js";

const router = express.Router();

router.post('/auth/register', validate(registerSchema), handleRegister);
router.post('/auth/login', validate(loginSchema), handleLogin);
router.post('/auth/logout', handleLogout);


export default router;