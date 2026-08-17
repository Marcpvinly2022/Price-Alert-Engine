import {supabase} from "../config/supabase.js";
import { logger } from "../utils/logger.js";

export const requireAuth = async (req, res, next) => {
    try{
        const authHeader = req.headers.authorization;
          // Structural Check: Ensure a Bearer token is provided
        if(!authHeader || !authHeader.startsWith("Bearer ")){
            logger.warn("Incoming request rejected: Missing or malformed Authorization header")
        return res.status(401).json({
            error: "Unauthorized: Access token missing."
        })
        }

        // Extract the raw string token out of the array split
        const token = authHeader.split(' ')[1];

        // Cryptographic Check: Pass token directly to Supabase engine for decoding
        const {data: {user}, error} = await supabase.auth.getUser(token);
        
         // Validation Check: If Supabase says no, return a 401 Unauthorized error immediately
       if(error || !user){
        logger.warn(`JWT Validation failed or rejected: ${error?.message || 'Context payload empty'}`);
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired validation token.'});
       }  

       req.user = {
        id: user.id,
        email: user.email
       };

       next();
    }catch(err){
        logger.error('Critical authorization middleware engine exception caught:', err);
        return res.status(500).json({ error: 'Internal Identity Verification Exception.'  })
    }
}