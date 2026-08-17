export const sendLogNotification = async (notification) => {
    console.log(
        `[NOTIFICATION] ALERT ${notification.alertId} triggered`
    );

    return {
        provider: "log",
        delivery: true,
    }
};