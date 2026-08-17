import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEmailNotification = async (notification) => {
  if (!process.env.RESEND_FROM_EMAIL) {
    throw new Error("RESEND_FROM_EMAIL is not configured");
  }

  const alert = notification.alert;

  if (!alert) {
    throw new Error("Alert data is missing from notification");
  }

  if (!alert.userEmail) {
    throw new Error("Notification recipient email is missing");
  }

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,

    to: alert.userEmail,

    subject: "Price Alert Triggered 🚨",

    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        
        <h2>Price Alert Triggered 🚨</h2>

        <p>
          Your price alert has been triggered.
        </p>

        <hr />

        <p>
          <strong>Currency Pair:</strong>
          ${alert.currencyPair}
        </p>

        <p>
          <strong>Target Rate:</strong>
          ${alert.targetRate.toString()}
        </p>

        <p>
          <strong>Condition:</strong>
          ${alert.condition}
        </p>

        <p>
          <strong>Alert ID:</strong>
          ${alert.id}
        </p>

        <hr />

        <p>
          Thank you for using Price Alert Engine.
        </p>

      </div>
    `,
  });

  if (error) {
    throw new Error(
      `Resend email failed: ${error.message}`
    );
  }

  console.log(
    `[EMAIL] Notification ${notification.id} sent via Resend`
  );

  return {
    provider: "resend",
    providerMessageId: data?.id,
  };
};