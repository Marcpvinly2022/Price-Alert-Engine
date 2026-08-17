import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { handleCreateAlert, handleGetAlerts, handleDeleteAlert } from "../controllers/alerts.controller.js";

import { validateCreateAlert } from "../validators/alert.validator.js";

const router = express.Router();

router.use(requireAuth);

router.post('/alerts', validateCreateAlert, handleCreateAlert);
router.get('/alerts', handleGetAlerts);
router.delete('/alerts/:id', handleDeleteAlert);

export default router;