import express from "express";
import { handleGetLatestRate } from "../controllers/rates.controller.js";

const router = express.Router();

router.get('/:currencyPair', handleGetLatestRate);

export default router;