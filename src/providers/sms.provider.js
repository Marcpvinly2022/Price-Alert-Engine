import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export const sendSmsNotification = async (notification) => {
  if (!process.env.TWILIO_PHONE_NUMBER) {
    throw new Error("TWILIO_PHONE_NUMBER is not configured");
  }

  const recipient = notification.alert?.phoneNumber;

  if (!recipient) {
    throw new Error("Notification recipient phone number is missing");
  }

  const message = await client.messages.create({
    body: "sms_order_confirmation",
    from: process.env.TWILIO_PHONE_NUMBER,
    to: recipient,
  });

  console.log(
    `[SMS] Notification ${notification.id} sent via Twilio`
  );

  return {
    provider: "twilio",
    providerMessageId: message.sid,
  };
};