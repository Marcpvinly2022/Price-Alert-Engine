import express from "express";
import { requireAuth } from "./middleware/auth.js";
import healthRoutes from './routes/health.routes.js'
import alertsRoutes from './routes/alerts.routes.js'
import authRoute from './routes/auth.routes.js';
import { errorHandler } from "./middleware/error.handling.js";
import ratesRoutes from './routes/rates.route.js';
const app = express();

app.use(express.json());


app.use('/api/v1', healthRoutes);

// 🔒 SECURE DEV ENDPOINT FOR VERIFICATION
app.get('/api/v1/auth-test', requireAuth, (req,res) => {
    res.status(200).json({
        message: "Identity Context Confirmed!",
        authenticatedUser: req.user
    });
});

app.use('/api/v1', authRoute);

app.use('/api/v1', alertsRoutes);

app.use('/api/v1/rates/latest', ratesRoutes);

app.use(errorHandler);
export default app;