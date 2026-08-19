import * as alertService from '../services/alerts.service.js';
import { logger } from '../utils/logger.js';

export const handleCreateAlert = async (req, res, next) => {
    try{
        if (!req.user) {
      return res.status(401).json({
        status: 'FAIL',
        error: 'UNAUTHORIZED',
        message: 'Authenticated user context missing',
      });
    }
        const {id: userId, email: userEmail} = req.user;
        const alert = await alertService.createNewUserAlert(
            userId,
            userEmail,
            req.validatedBody
        );

        logger.info({
            event: 'alert_created',
            alertId: alert.id,
            userId,
            pair: alert.currencyPair,
        });

        return res.status(201).json({
            status: 'SUCCESS',
            data: alert,
        });

    }catch(err){
        next(err);
    }
};


export const handleGetAlerts = async (req, res, next) => {
    try{
        const result = await alertService.fetchPaginatedUserAlerts(
            req.user.id,
            req.query.page,
            req.query.limit
        );

        return res.status(200).json({
            status: 'SUCCESS',
            meta: result.meta,
            data: result.alerts,
        });
    }catch(err){
        next(err);
    }
};

export const handleDeleteAlert = async (req, res, next) => {
    try{
        const deleted = await alertService.removeUserAlert(
            req.params.id,
            req.user.id
        );

        if(!deleted){
            return res.status(404).json({
                status: 'FAIL',
                error: 'NOT_FOUND',
                message: 'Alert not Found',
            });
        }

        logger.info({
            event: 'alert_deleted',
            alertId: req.params.id,
            userId: req.user.id,
        });
    return res.status(204).send();
    }catch(err){
        next(err);
    }

};


