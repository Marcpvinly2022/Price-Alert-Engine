import { sendLogNotification } from "../providers/log.provider.js";
import { sendEmailNotification } from "../providers/email.provider.js";
import { sendSmsNotification } from "../providers/sms.provider.js";

const Providers = {
    LOG: sendLogNotification,
    EMAIL: sendEmailNotification,
    SMS: sendSmsNotification,
};

export const sendNotification = async (notification) => {
   const provider = Providers[notification.channel];

   if(!provider){
    throw new Error(`Unsupported notification channel: ${notification.channel}`);
   };

   return provider(notification);
};