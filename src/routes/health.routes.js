// src/routes/health.routes.js
import express from 'express';
// ✅ Explicit path lookup to ensure your backend pulls your database.js file
import prisma from '../config/database.js'; 
import prismaDirect from '../config/database.direct.js';
import { Prisma } from '@prisma/client';

const router = express.Router();

// ✅ Strict arrow function formatting for the route handler
router.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prismaDirect.$queryRaw`SELECT 1`;

    return res.status(200).json({
      status: 'UP',
      infrastructure: {
        pooled: 'CONNECTED',
        direct: 'CONNECTED',
      },
    });
  } catch (err) {
    return res.status(503).json({
      status: 'DOWN',
      error: err.message,
    });
  }
});

export default router;
