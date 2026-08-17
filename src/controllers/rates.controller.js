import * as rateService from '../services/rates.service.js';

export const handleGetLatestRate = async (req, res, next) => {
    try{
        const rate = await rateService.getLatestRate(
            req.params.currencyPair
        );

        if(!rate){
            return res.status(404).json({
                status: 'FALL',
                error: 'RATE_NOT_FOUND',
                message: 'No rate available for this currency pair',
            });
        }

        return res.status(200).json({
            status: 'SUCCESS',
            data: rate,
        });

    }catch(err){
        next(err);
    }
};